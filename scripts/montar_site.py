"""Monta o site do GitHub Pages: página inicial + teste rápido + simulador (modo online).
Uso: python3 montar_site.py <raiz_repo> <dados_online.json> <teste_rapido_rtc.html> <versao.json> <saida_dir>"""
import json, os, shutil, sys, html

raiz, dados, rapido, versao, saida = sys.argv[1:6]
v = json.load(open(versao, encoding='utf-8'))
d = json.load(open(dados, encoding='utf-8'))
shutil.rmtree(saida, ignore_errors=True)
os.makedirs(os.path.join(saida, 'teste-rapido'))
shutil.copy(rapido, os.path.join(saida, 'teste-rapido', 'index.html'))

sim = os.path.join(saida, 'simulador')
shutil.copytree(os.path.join(raiz, 'web'), sim)
shutil.copy(os.path.join(raiz, 'ferramentas', 'teste_rapido', 'motor_rapido.js'), os.path.join(sim, 'js', 'motor_tabelas.js'))
with open(os.path.join(sim, 'js', 'dados_online.js'), 'w', encoding='utf-8') as f:
    f.write('window.DADOS_ONLINE = ' + json.dumps(d, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';\n')
    f.write('window.API_OFFLINE = criarApiOffline(window.DADOS_ONLINE, criarMotor);\n')
with open(os.path.join(sim, 'versao.json'), 'w', encoding='utf-8') as f:
    json.dump(v, f)
pagina = open(os.path.join(sim, 'simulador.html'), encoding='utf-8').read()
pagina = pagina.replace('<script src="js/descoberta.js"></script>',
    '<script src="js/motor_tabelas.js"></script>\n<script src="js/api_offline.js"></script>\n<script src="js/dados_online.js"></script>\n<script src="js/descoberta.js"></script>')
assert 'dados_online.js' in pagina
open(os.path.join(sim, 'index.html'), 'w', encoding='utf-8').write(pagina)
os.remove(os.path.join(sim, 'simulador.html'))

conf = d.get('conferido', {})
inicio = f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calculadora da Reforma</title>
<style>
:root{{--fundo:#f5f6f8;--cartao:#fff;--texto:#1d2330;--suave:#5b6475;--borda:#e1e4ea;--dest:#1f5fbf;--dest-t:#fff}}
@media (prefers-color-scheme:dark){{:root{{--fundo:#12151b;--cartao:#1b1f27;--texto:#e7eaf0;--suave:#a0a8b8;--borda:#2c323d;--dest:#5b9bff;--dest-t:#0b1220}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.55 "Segoe UI",system-ui,sans-serif}}
main{{max-width:880px;margin:0 auto;padding:32px 16px}}h1{{font-size:24px;margin:0 0 4px}}.sub{{color:var(--suave);margin:0 0 24px}}
.grade{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}}
a.cartao{{display:block;background:var(--cartao);border:1px solid var(--borda);border-radius:12px;padding:20px;color:inherit;text-decoration:none}}
a.cartao:hover{{border-color:var(--dest)}}a.cartao h2{{margin:0 0 6px;font-size:18px;color:var(--dest)}}a.cartao p{{margin:0;color:var(--suave)}}
.rodape{{margin-top:28px;font-size:13px;color:var(--suave)}}.rodape a{{color:var(--dest)}}
</style></head><body><main>
<h1>Reforma Tributária: CBS, IBS e Imposto Seletivo</h1>
<p class="sub">Ferramentas sobre a calculadora oficial da Receita Federal · tabelas {html.escape(v.get("versaoDb",""))} de {"/".join(reversed(v.get("dataVersaoDb","").split("-")))} · calculadora v{html.escape(v.get("versaoApp",""))}</p>
<div class="grade">
<a class="cartao" href="teste-rapido/"><h2>Teste rápido</h2><p>Cole NCMs ou NBS e veja na hora a cClassTrib, a alíquota efetiva e o racional com a base legal e o item do anexo.</p></a>
<a class="cartao" href="simulador/"><h2>Simulador</h2><p>Planilha-modelo, importação do Excel, cálculo por ano da transição (2026–2033), impacto em carga, receita e margem, e exportação para Excel.</p></a>
</div>
<p class="rodape">Tudo roda no seu navegador: nenhuma planilha é enviada para a internet. A versão online foi conferida ao centavo com a calculadora oficial em {conf.get("comparacoes","?")} cálculos.
Para os casos especiais, use o <a href="https://github.com/lucassouzafigueredo/CalculadoraReceita/releases/latest">simulador instalado (Windows)</a>.
Motor oficial: <a href="https://github.com/ReceitaFederal/calculadora-rtc-regime-regular">ReceitaFederal/calculadora-rtc-regime-regular</a>. Simulação gerencial; não substitui a apuração fiscal.</p>
</main></body></html>'''
open(os.path.join(saida, 'index.html'), 'w', encoding='utf-8').write(inicio)
open(os.path.join(saida, '.nojekyll'), 'w').close()
print('site em', saida)
