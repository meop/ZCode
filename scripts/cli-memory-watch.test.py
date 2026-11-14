"""Identity, orphan and log-retention regressions for the read-only observer."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('cli-memory-watch.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObserverTests(unittest.TestCase):
    def test_children_orphans_and_reused_pids(self):
        root = {'pid': 10, 'ppid': 1, 'start_ticks': 100}
        child = {'pid': 11, 'ppid': 10, 'start_ticks': 200}
        grandchild = {'pid': 12, 'ppid': 11, 'start_ticks': 300}
        tracked = observer.select_tree({10: root, 11: child, 12: grandchild}, root, {})
        self.assertEqual(tracked, {10: 100, 11: 200, 12: 300})
        orphan = {**child, 'ppid': 1}
        reused = {**grandchild, 'ppid': 1, 'start_ticks': 999}
        self.assertEqual(observer.select_tree({11: orphan, 12: reused}, root, tracked), {11: 200})
        self.assertEqual(observer.select_tree({10: {**root, 'start_ticks': 999}}, root, tracked), {})

    def test_stat_with_spaces_and_parentheses(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            (proc / '10').mkdir()
            fields = ['S', '1'] + ['0'] * 17 + ['12345']
            (proc / '10/stat').write_text('10 (name with ) parentheses) ' + ' '.join(fields))
            self.assertEqual(observer.read_identity(10, proc), {'pid': 10, 'ppid': 1, 'start_ticks': 12345})

    def test_rotation_bounds_backup_count(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'samples.jsonl'
            for index in range(6):
                path.write_text(str(index) * 10)
                observer.rotate(path, 10, 3)
            self.assertEqual(len(list(Path(directory).iterdir())), 3)
            self.assertEqual(Path(f'{path}.1').read_text(), '5' * 10)
            self.assertEqual(Path(f'{path}.3').read_text(), '3' * 10)


if __name__ == '__main__':
    unittest.main()
