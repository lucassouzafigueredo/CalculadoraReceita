"""
Texto consolidado da LC 214/2025 a partir do portal Normas do Senado (normas.leg.br, dados abertos LexML).
O Planalto recusa acessos de servidores fora do Brasil (GitHub Actions); o Senado não.

Uso:
  python3 lei_senado.py baixar <saida.json>              # baixa a norma estruturada
  python3 lei_senado.py artigos <norma.json> <saida.json> # extrai {"138": "Art. 138. ... § 2º ... I - ..."}
  python3 lei_senado.py mostrar <norma.json> 138          # imprime um artigo
Para cada dispositivo usa a versão mais recente (redação vigente, com alterações posteriores).
"""
import html
import json
import re
import sys
import urllib.request

URN = 'urn:lex:br:federal:lei.complementar:2025-01-16;214'
URL = f'https://normas.leg.br/api/public/normas?urn={URN}&tipo_documento=maior-detalhe'


def baixar(saida):
    with urllib.request.urlopen(URL, timeout=120) as r:
        dados = r.read()
    json.loads(dados)  # valida
    open(saida, 'wb').write(dados)
    print(saida, len(dados), 'bytes')


def limpar(t):
    t = re.sub(r'<[^>]+>', '', str(t))
    return ' '.join(html.unescape(t).split())


def mesclar(dados_path, norma_path):
    """Acrescenta ao retrato (dados.json) os artigos da LC 214 citados nas classificações."""
    dados = json.load(open(dados_path, encoding='utf-8'))
    arts = artigos(json.load(open(norma_path, encoding='utf-8')))
    citados = set()
    for c in dados.get('classes', []):
        f = c.get('_fund') or {}
        for m in re.finditer(r'Art\.?\s*(\d+[-A-Z]*)', f.get('textoCurto') or ''):
            citados.add(m.group(1).replace('-', '').upper())
    # artigos desta LC citados dentro dos artigos de base legal (ex.: art. 125 remete ao art. 126)
    relacionados = set()
    for n in list(citados):
        for m in re.finditer(r'arts?\.\s*(\d+)[ºo°]?(?:-([A-Z]))?(?:[^.;]{0,60}?)desta Lei Complementar', arts.get(n, '')):
            relacionados.add((m.group(1) + (m.group(2) or '')).upper())
    dados['lei'] = {n: arts[n] for n in sorted(citados | relacionados) if n in arts}
    dados['leiFonte'] = {'fonte': 'Portal Normas do Senado Federal (normas.leg.br), texto consolidado da LC 214/2025', 'url': URL}
    json.dump(dados, open(dados_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f"lei: {len(dados['lei'])} artigos no retrato ({len(citados)} de base legal + relacionados)")


def versao_vigente(no):
    """Escolhe a redação mais recente do dispositivo (workExample pode ser objeto ou lista)."""
    we = no.get('workExample')
    if not we:
        return None
    lista = we if isinstance(we, list) else [we]
    lista = [w for w in lista if isinstance(w, dict)]
    if not lista:
        return None
    return max(lista, key=lambda w: str(w.get('legislationDate') or ''))


def filhos(no):
    hp = no.get('hasPart')
    if not hp:
        return []
    return hp if isinstance(hp, list) else [hp]


def ident(no):
    v = versao_vigente(no) or {}
    return str(v.get('legislationIdentifier') or no.get('legislationIdentifier') or '')


def texto_dispositivo(no, nivel=0):
    v = versao_vigente(no) or {}
    nome = limpar(v.get('name') or '')
    txt = limpar(v.get('text') or '')
    linhas = []
    if nome or txt:
        if re.search(r'revogad', txt, re.I) and not nome:
            pass
        linhas.append(f"{nome} {txt}".strip())
    for f in filhos(no):
        linhas.extend(texto_dispositivo(f, nivel + 1))
    return linhas


def artigos(norma):
    out = {}

    def andar(no):
        i = ident(no)
        m = re.search(r'!art(\d+[a-z-]*)$', i)
        if m:
            num = m.group(1).replace('-', '').upper().lstrip('0')
            linhas = texto_dispositivo(no)
            # junta caput ao "Art. N."
            if len(linhas) >= 2 and re.fullmatch(r'Art\.\s*\d+[-A-Z]*\.?', linhas[0]):
                linhas = [f'{linhas[0]} {linhas[1]}'] + linhas[2:]
            out[num] = '\n'.join(l for l in linhas if l)
            return
        for f in filhos(no):
            andar(f)

    andar(norma)
    return out


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'baixar':
        baixar(sys.argv[2])
    elif cmd == 'artigos':
        a = artigos(json.load(open(sys.argv[2], encoding='utf-8')))
        json.dump(a, open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False)
        print(len(a), 'artigos')
    elif cmd == 'mesclar':
        mesclar(sys.argv[2], sys.argv[3])
    elif cmd == 'mostrar':
        print(artigos(json.load(open(sys.argv[2], encoding='utf-8'))).get(sys.argv[3].upper(), '(não encontrado)'))
