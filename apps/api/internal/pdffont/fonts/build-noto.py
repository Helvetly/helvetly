"""Builds the fallback fonts embedded by internal/pdffont from upstream Noto fonts (SIL OFL 1.1).

fpdf reads only TrueType outlines and a format-4 (BMP) cmap, so variable fonts are pinned to their
Regular instance, and the emoji above U+FFFF are re-encoded into the Private Use Area (emoji-pua.txt
lists them in order: line i is U+E000+i)."""
import gzip, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

src, out = sys.argv[1], sys.argv[2]

def static(path):
    f = TTFont(path)
    if 'fvar' in f:
        f = instancer.instantiateVariableFont(f, {a.axisTag: a.defaultValue if a.axisTag != 'wght' else 400 for a in f['fvar'].axes})
    return f

def cut(f, unicodes):
    o = subset.Options(); o.hinting = False; o.layout_features = ['*']; o.name_IDs = ['*']; o.notdef_outline = True; o.glyph_names = False
    s = subset.Subsetter(o); s.populate(unicodes=unicodes); s.subset(f); return f

def bmp_only(f):
    # one format-4 Windows Unicode cmap, the only kind fpdf reads
    best = {u: g for u, g in f.getBestCmap().items() if u <= 0xFFFF}
    t = CmapSubtable.newSubtable(4); t.platformID, t.platEncID, t.language, t.cmap = 3, 1, 0, best
    f['cmap'].tables = [t]; return f

def save(f, name):
    f.save(f'{out}/{name}.ttf')
    with open(f'{out}/{name}.ttf', 'rb') as r, gzip.GzipFile(f'{out}/{name}.ttf.gz', 'wb', 9, mtime=0) as w: w.write(r.read())

hangul = [*range(0x1100, 0x1200), *range(0x3130, 0x3190), *range(0xA960, 0xA980), *range(0xAC00, 0xD7B0), *range(0xD7B0, 0xD800)]
for name in ['NotoSans', 'NotoSansArabic', 'NotoSansDevanagari', 'NotoSansThai', 'NotoSansMath', 'NotoSansSymbols', 'NotoSansSymbols2']:
    f = TTFont(f'{src}/{name}-Regular.ttf')
    save(bmp_only(cut(f, [u for u in f.getBestCmap() if u <= 0xFFFF])), name)
f = static(f'{src}/SC.ttf'); save(bmp_only(cut(f, [u for u in f.getBestCmap() if u <= 0xFFFF])), 'NotoSansSC')
f = static(f'{src}/KR.ttf'); save(bmp_only(cut(f, hangul)), 'NotoSansKR-Hangul')

f = static(f'{src}/Emoji.ttf')
cmap = f.getBestCmap()
smp = sorted(u for u in cmap if u > 0xFFFF)
f = cut(f, list(cmap))
cmap = f.getBestCmap()
bmp = {u: g for u, g in cmap.items() if u <= 0xFFFF and not 0xE000 <= u <= 0xF8FF}
assert len(smp) <= 0xF8FF - 0xE000
for i, u in enumerate(smp): bmp[0xE000 + i] = cmap[u]
t = CmapSubtable.newSubtable(4); t.platformID, t.platEncID, t.language, t.cmap = 3, 1, 0, bmp
f['cmap'].tables = [t]
save(f, 'NotoEmoji')
open(f'{out}/emoji-pua.txt', 'w').write(''.join(f'{u:X}\n' for u in smp))
