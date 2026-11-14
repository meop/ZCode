#!/usr/bin/env python3
"""Read-only Linux process-tree memory observer. No credentials or argv collected."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time


def read_identity(pid, proc=Path('/proc')):
    # comm can contain spaces and parentheses; fields after its final ')' are numeric.
    fields = (proc / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': pid, 'ppid': int(fields[1]), 'start_ticks': int(fields[19])}


def select_tree(table, root, tracked):
    """Preserve known children after reparenting, but never follow a reused PID."""
    selected = {
        pid for pid, item in table.items()
        if tracked.get(pid) == item['start_ticks']
    }
    if table.get(root['pid'], {}).get('start_ticks') == root['start_ticks']:
        selected.add(root['pid'])
    while True:
        children = {pid for pid, item in table.items() if item['ppid'] in selected}
        expanded = selected | children
        if expanded == selected:
            break
        selected = expanded
    return {pid: table[pid]['start_ticks'] for pid in selected}


def read_kib(path, keys):
    result = {}
    for line in path.read_text().splitlines():
        key, _, value = line.partition(':')
        if key in keys:
            result[key] = int(value.split()[0]) * 1024
    return result


def sample_process(identity, proc=Path('/proc')):
    base = proc / str(identity['pid'])
    result = dict(identity)
    result['name'] = (base / 'comm').read_text().strip()
    try:
        result['executable'] = os.readlink(base / 'exe')
    except OSError:
        pass
    result['bytes'] = read_kib(base / 'status', {'VmRSS', 'VmSwap', 'VmSize'})
    try:
        result['bytes'].update(read_kib(base / 'smaps_rollup', {
            'Pss', 'Pss_Anon', 'Pss_File', 'Pss_Shmem', 'Private_Clean',
            'Private_Dirty', 'SwapPss', 'Anonymous',
        }))
    except OSError:
        result['smaps_unavailable'] = True
    for name in ('fd', 'task'):
        try:
            result[name + '_count'] = len(list((base / name).iterdir()))
        except OSError:
            pass
    # Process exit/reuse between /proc reads must not combine different identities.
    if read_identity(identity['pid'], proc)['start_ticks'] != identity['start_ticks']:
        raise ProcessLookupError(identity['pid'])
    return result


def rotate(path, max_bytes, backups):
    if not path.exists() or path.stat().st_size < max_bytes:
        return
    for index in range(backups, 0, -1):
        previous = path if index == 1 else Path(f'{path}.{index - 1}')
        if previous.exists():
            previous.replace(Path(f'{path}.{index}'))


def positive_float(value):
    number = float(value)
    if not 0 < number < float('inf'):
        raise argparse.ArgumentTypeError('must be a finite positive number')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path,
                        help='JSONL path on persistent storage, preferably outside /tmp')
    parser.add_argument('--interval', type=positive_float, default=60)
    parser.add_argument('--duration', type=positive_float, default=86400)
    args = parser.parse_args()
    if not Path('/proc/self/smaps_rollup').exists():
        parser.error('requires Linux procfs with smaps_rollup support')
    try:
        root = read_identity(args.pid)
    except (OSError, ValueError):
        parser.error('root PID is not accessible')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tracked = {args.pid: root['start_ticks']}
    started = time.monotonic()
    while True:
        table = {}
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                item = read_identity(int(entry.name))
                table[item['pid']] = item
            except (OSError, ValueError, IndexError):
                continue
        tracked = select_tree(table, root, tracked)
        members = []
        for pid in sorted(tracked):
            try:
                members.append(sample_process(table[pid]))
            except (OSError, ValueError, IndexError):
                continue
        alive = table.get(args.pid, {}).get('start_ticks') == root['start_ticks']
        sample = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'elapsed_seconds': round(time.monotonic() - started, 3),
            'root': root, 'root_alive': alive, 'processes': members,
            'totals_bytes': {
                key: sum(member['bytes'].get(key, 0) for member in members)
                for key in ('VmRSS', 'VmSwap', 'Pss', 'SwapPss',
                            'Private_Clean', 'Private_Dirty')
            },
            'pss_complete': all(not m.get('smaps_unavailable') for m in members),
        }
        rotate(args.output, 5 * 1024 * 1024, 3)
        # Only the observer's output file changes; no target process is signaled.
        with args.output.open('a', encoding='utf-8') as output:
            output.write(json.dumps(sample, separators=(',', ':')) + '\n')
        remaining = args.duration - (time.monotonic() - started)
        if not alive or remaining <= 0:
            break
        time.sleep(min(args.interval, remaining))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
