#!/usr/bin/env python3
# X3 dışındaki oda tipleri için kontrol adımlarını Excel'deki oda özelliklerinden üretir ve
# data/HK_Veri_Toplama.xlsx → Kontrol Adımları sayfasına yazar (X3 satırlarına dokunmaz).
import sys, openpyxl
from copy import copy
path = sys.argv[1]
wb = openpyxl.load_workbook(path)
types = {}
for r in wb['Oda Tipleri'].iter_rows(min_row=2, values_only=True):
    if r[0] and len(str(r[0])) <= 10:
        types[r[0]] = dict(name=r[1], bed=str(r[5] or ''), kitchen=r[7] == 'Evet', bath=str(r[8] or ''), outdoor=str(r[9] or ''))
fs = wb['Oda Özellikleri']
hdr = [c.value for c in fs[1]]
feat = {t: set() for t in types}
for r in fs.iter_rows(min_row=2, values_only=True):
    if not r[1]: continue
    for i, code in enumerate(hdr[2:], start=2):
        if code in feat and r[i] == 'Evet': feat[code].add(r[1])

def has(code, f):
    t, F = types[code], feat[code]
    village = not F  # Village tiplerinin özellik satırları boş: Oda Tipleri sütunlarından çıkarılır
    m = {
        'kitchen': t['kitchen'], 'fridge': 'Buzdolabı' in F or (village and t['kitchen']),
        'stove': 'Ocak' in F or (village and t['kitchen']), 'tub': 'Küvet' in t['bath'] or 'Küvet' in F,
        'balcony': 'Balkon' in t['outdoor'] or 'Balkon' in F, 'terrace': 'Teras' in t['outdoor'] or 'Teras' in F,
        'garden': 'Bahçe' in t['outdoor'] or 'Bahçe' in F, 'bbq': 'Barbekü' in F,
        'safe': 'Kasa' in F, 'sofa': 'Kanepe' in F or 'Sofa' in t['bed'],
        'sitting': 'Oturma Alanı' in F or 'Çalışma Masası' in F or village,
        'micro': 'Mikrodalga' in F, 'oven': 'Fırın' in F, 'coffee': 'Kahve Makinesi' in F,
        'dish': 'Bulaşık Makinesi' in F, 'washer': 'Çamaşır Makinesi' in F, 'robe': 'Bornoz' in F,
        'kettle_only': not t['kitchen'] and ('Su Isıtıcısı' in F or village),
    }
    return m[f]

Y, N = 'Evet', 'Hayır'
G = 'Konaklama kontrolündeysen misafir eşyalarını değerlendirme.'
def steps(code):
    s = []
    def add(zone, title, instr, checks, full=Y, stay=Y, flash=N, ai=''):
        s.append((zone, title, instr, '\n'.join(checks), full, stay, flash, Y, 1, ai))
    add('Giriş', 'Giriş ve kapı', 'Kapıdan girip girişi ve koridoru tek karede çek. Tüm ışıklar açık olsun.',
        ['Kapı ve şifreli kilit çalışıyor', 'Süpürgelik ve duvar dipleri tozsuz', 'Aplikler yanıyor', 'Zeminde leke, saç, kum yok'],
        ai='Zeminde görünür kir, saç, çöp var mı? Yanmayan lamba var mı? ' + G)
    add('Banyo', 'Lavabo ve ayna', 'Lavabo, batarya, ayna ve havlu rafı aynı karede olacak şekilde çek.',
        ['Lavabo içi ve gider temiz', 'Batarya parlak, su lekesi yok', 'Sıvı sabun dolu', 'Ayna lekesiz', 'Havlular katlı ve tam']
        + (['Bornozlar asılı'] if has(code, 'robe') else []),
        ai='Lavaboda kıl, sabun kalıntısı, su lekesi var mı? Aynada leke var mı? Havlular düzgün katlı mı? ' + G)
    add('Banyo', 'WC', 'Klozet kapağı açık, tuvalet kağıdı ve yedek rulo görünecek şekilde çek.',
        ['Klozet içi, kapak altı ve dış yüzey temiz', 'WC fırçası temiz', 'Tuvalet kağıdı takılı + yedek rulo', 'Çöp kovası boş, poşet yeni'],
        ai='Klozet içinde veya kapakta leke/kir var mı? Tuvalet kağıdı ve yedek rulo var mı? Çöp kovası boş mu?')
    add('Banyo', 'Duş', 'Duş camını ışığa karşı çek (kireç böyle görünür); dispenserler ve gider görünsün.',
        ['Camda kireç ve su lekesi yok', 'Duş seti askıda', 'Şampuan/duş jeli dolu', 'Giderde saç yok'],
        ai='Duş camında kireç/su lekesi, giderde saç, zeminde kir var mı? ' + G)
    if has(code, 'tub'):
        add('Banyo', 'Küvet', 'Küveti üstten, gider ve batarya görünecek şekilde çek.',
            ['Küvet içi temiz, kireç halkası yok', 'Giderde saç yok', 'Batarya parlak'],
            ai='Küvette kir halkası, saç, kireç var mı?')
    add('Oda', 'Gardırop', 'Kapakları aç, askıları ve rafları tek karede çek. İçerisi karanlıksa feneri aç.',
        ['Askılar tam', 'Yedek battaniye/yastık katlı', 'Unutulmuş eşya yok'], stay=N, flash=Y,
        ai='Gardıropta unutulmuş eşya, çöp var mı? Askılar düzenli mi?')
    if has(code, 'safe'):
        add('Oda', 'Kasa', 'Kasa kapağını açıp içini çek.', ['Kasa boş', 'Kasa açık bırakılmış, kilitli değil'], stay=N, flash=Y,
            ai='Kasanın içinde eşya var mı? Kapak açık mı?')
    if has(code, 'kitchen'):
        add('Mutfak', 'Mutfak tezgahı', 'Tezgahın karşısından ocak, evye, kettle ve bulaşıklık tek karede olacak şekilde çek.',
            (['Ocak temiz'] if has(code, 'stove') else []) + ['Evye ve batarya temiz', 'Sünger ve fırça temiz', 'Bulaşıklık boş ve kuru',
             'Kettle boş, kablosu toplanmış', 'Tuz-biber-yağ dolu', 'Çöp kovası boş'],
            ai='Tezgahta, ocakta, evyede kir, yağ, kırıntı veya bulaşık var mı? Çöp dolu mu? ' + G)
        add('Mutfak', 'Çekmeceler', 'Çekmeceleri sırayla aç, feneri aç ve her birini tam üstten çek.',
            ['Çatal, kaşık, bıçak tam', 'Servis gereçleri yerinde', 'Çekmece içleri kırıntısız'], stay=N, flash=Y,
            ai='Çekmece içinde kırıntı, kir, yerinden oynamış eşya var mı?')
        s[-1] = s[-1][:8] + (2,) + s[-1][9:]
        add('Mutfak', 'Dolaplar: tabak, bardak, tencere', 'Üst ve alt dolapların kapaklarını aç, feneri aç; tabak, bardak ve tencereler görünsün.',
            ['Tabak, kase, bardak, kupa sayısı tam', 'Bardaklarda su lekesi, kupalarda çay/kahve izi yok', 'Tencere ve tavalar temiz, kapaklı',
             'Evye altında sızıntı yok'], stay=N, flash=Y,
            ai='Bardaklarda leke, tabaklarda iz/çatlak, tencerelerde yemek kalıntısı var mı?')
        s[-1] = s[-1][:8] + (2,) + s[-1][9:]
    if has(code, 'fridge'):
        add('Mutfak', 'Buzdolabı', 'Kapağı tamamen aç; içi ve kapak rafları görünsün.', ['Raflar temiz', 'Unutulmuş yiyecek yok', 'Koku ve buzlanma yok'],
            stay=N, ai='Buzdolabında yiyecek kalıntısı, leke, buzlanma var mı?')
    if has(code, 'oven') or has(code, 'micro'):
        names = ' ve '.join(x for x, f in (('fırın', 'oven'), ('mikrodalga', 'micro')) if has(code, f))
        add('Mutfak', names.capitalize(), f'{names.capitalize()} kapağını açıp içini çek.', ['İçi temiz, yağ ve yemek kalıntısı yok', 'Tabla yerinde'],
            stay=N, flash=Y, ai='İçeride yağ, yanık, yemek kalıntısı var mı?')
    if has(code, 'coffee') or has(code, 'dish'):
        names = ' ve '.join(x for x, f in (('kahve makinesi', 'coffee'), ('bulaşık makinesi', 'dish')) if has(code, f))
        add('Mutfak', names.capitalize(), f'{names.capitalize()} görünsün; bulaşık makinesinin kapağını açıp çek.',
            ['Kahve makinesi temiz, haznesi boş', 'Bulaşık makinesi boş ve temiz'], stay=N, ai='Makinede kirli bulaşık veya kahve kalıntısı var mı?')
    if has(code, 'washer'):
        add('Mutfak', 'Çamaşır makinesi', 'Kapağını açıp tamburu çek.', ['Tambur boş', 'Kapak lastiği temiz'], stay=N, flash=Y,
            ai='Tamburda unutulmuş çamaşır var mı?')
    if has(code, 'kettle_only'):
        add('Oda', 'Kettle ve ikram', 'Kettle, bardaklar ve ikram tepsisini tek karede çek.',
            ['Kettle boş ve temiz', 'Bardaklar lekesiz', 'İkram tepsisi tam'], ai='Bardaklarda leke, kettle içinde su/kireç var mı? İkram eksik mi?')
    add('Oda', 'TV ve ünite', 'TV ve ünite raflarını önden çek.', ['TV ekranı tozsuz', 'Ünite rafları tozsuz', 'Kumandalar yerinde'],
        ai='TV ve raflarda toz, leke var mı? ' + G)
    if has(code, 'sitting'):
        add('Oda', 'Oturma alanı ve masa', 'Pencereye doğru geniş açıyla çek; masa, koltuklar ve kanepe görünsün.',
            ['Perde ve tül düzgün', 'Masa temiz', 'Koltuk/kanepe temiz, minderler düzgün'] + (['Sofa yatak toplanmış'] if has(code, 'sofa') else []),
            ai='Masada, koltuklarda kir, leke, unutulmuş eşya var mı? ' + G)
    two_beds = code in ('DFS',)
    add('Oda', 'Yatak ve komodinler', 'Yatağı ayak ucundan tamamı görünecek şekilde çek; ikinci karede yatak altını ve komodinleri çek.'
        + (' Dubleks: üst ve alt kattaki yatakların her biri için ayrı kare.' if two_beds else ''),
        ['Çarşaf dört köşeden gergin', 'Yastıklar tam, kılıflar lekesiz', 'Yatak altında eşya/toz yok', 'Komodinler boş ve tozsuz'],
        ai='Çarşafta kırışık, leke, saç var mı? Yastıklar düzgün mü? Yatak altında eşya/toz var mı? ' + G)
    s[-1] = s[-1][:8] + (3 if two_beds else 2,) + s[-1][9:]
    if has(code, 'balcony'):
        add('Dış alan', 'Balkon', 'Balkon kapısından balkonun tamamını çek.', ['Zemin süpürülmüş', 'Masa ve sandalyeler temiz', 'Kül tablası boş'],
            ai='Balkonda çöp, izmarit, kir var mı? ' + G)
    if has(code, 'terrace'):
        add('Dış alan', 'Teras', 'Terasın tamamını geniş açıyla çek.', ['Zemin süpürülmüş', 'Oturma grubu temiz', 'Çöp yok'],
            ai='Terasta çöp, yaprak, kir var mı? ' + G)
    if has(code, 'bbq'):
        add('Dış alan', 'Barbekü', 'Barbeküyü kapağı açık çek.', ['Izgara temiz', 'Kül boşaltılmış'], stay=N, ai='Izgarada yağ/yemek kalıntısı veya kül var mı?')
    if has(code, 'garden'):
        add('Dış alan', 'Bahçe', 'Bahçeyi kapıdan geniş açıyla çek.', ['Çöp yok', 'Bahçe mobilyaları düzenli'], stay=N, ai='Bahçede çöp var mı, mobilyalar dağınık mı?')
    add('Oda', 'Genel oda', 'Kapı tarafından tüm odayı tek geniş karede çek. Tüm ışıklar açık.',
        ['Klima çalışıyor', 'Çöp kovaları boş', 'Zemin temiz', 'Duvarda iz yok', 'Tüm aydınlatma yanıyor'],
        ai='Zeminde kir, çöp; yanmayan lamba; dağınıklık var mı? ' + G)
    return s

ws = wb['Kontrol Adımları']
hdr = [c.value for c in ws[1]]
for name in ('Kare Sayısı', 'AI Talimatı'):
    if name not in hdr:
        col = len(hdr) + 1
        ws.cell(1, col, name)
        ws.cell(1, col)._style = copy(ws.cell(1, len(hdr))._style)
        hdr.append(name)
# Eski üretilmiş satırları (X3 dışı) temizle
for row in range(ws.max_row, 1, -1):
    v = ws.cell(row, 1).value
    if v and v != 'X3' and v in types: ws.delete_rows(row)
last = max(r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value)
style_row = 2
n = 0
for code in types:
    if code == 'X3': continue
    for i, st in enumerate(steps(code), start=1):
        last += 1
        vals = (code, i) + st[:7] + (st[8], st[9])
        cols = list(range(1, 10)) + [hdr.index('Kare Sayısı') + 1, hdr.index('AI Talimatı') + 1]
        for c, v in zip(cols, vals):
            cell = ws.cell(last, c, v)
            cell._style = copy(ws.cell(style_row, min(c, 10))._style)
        n += 1
wb.save(path)
print('yazılan adım:', n)
for code in types:
    if code != 'X3': print(code, len(steps(code)), sum(x[8] for x in steps(code)), 'kare')
