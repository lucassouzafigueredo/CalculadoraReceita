import sys, datetime
modelo, dados, regras, motor, saida = sys.argv[1:6]
h = open(modelo, encoding='utf-8').read()
d = open(dados, encoding='utf-8').read().replace('</', '<\\/')
h = h.replace('/*DADOS*/', d).replace('/*REGRAS*/', open(regras, encoding='utf-8').read()).replace('/*MOTOR*/', open(motor, encoding='utf-8').read())
h = h.replace('/*GERADO*/', datetime.date.today().strftime('%d/%m/%Y'))
open(saida, 'w', encoding='utf-8').write(h)
print(saida, round(len(h.encode()) / 1e6, 2), 'MB')
