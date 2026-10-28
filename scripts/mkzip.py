"""Zip that keeps symlinks and permissions, like ditto -c -k. Usage: mkzip.py OUT SRC=ARCNAME ..."""
import os, sys, zipfile, stat
out = sys.argv[1]; entries = sys.argv[2:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for e in entries:
        src, arc = e.split('=', 1)
        if os.path.isfile(src) and not os.path.islink(src):
            z.write(src, arc); continue
        for root, dirs, files in os.walk(src, followlinks=False):
            for n in sorted(dirs + files):
                p = os.path.join(root, n); a = os.path.join(arc, os.path.relpath(p, src)); st = os.lstat(p)
                if stat.S_ISLNK(st.st_mode):
                    zi = zipfile.ZipInfo(a); zi.create_system = 3; zi.external_attr = (stat.S_IFLNK | 0o755) << 16
                    z.writestr(zi, os.readlink(p))
                elif stat.S_ISDIR(st.st_mode):
                    zi = zipfile.ZipInfo(a + '/'); zi.create_system = 3; zi.external_attr = (stat.S_IFDIR | 0o755) << 16 | 0x10
                    z.writestr(zi, b'')
                else:
                    zi = zipfile.ZipInfo.from_file(p, a); zi.create_system = 3; zi.external_attr = (st.st_mode & 0xFFFF) << 16
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    with open(p, 'rb') as f: z.writestr(zi, f.read())
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
print(out, os.path.getsize(out) // 1048576, 'MB')
