# Simulador da Reforma Tributária (CBS / IBS / IS)

Simulador de impacto da Reforma Tributária do Consumo (LC 214/2025) que usa como motor a
[calculadora oficial da Receita Federal](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular).
O usuário sobe uma planilha padrão e recebe carga atual × nova por ano de transição,
impacto em receita líquida e margem, reajuste de preço necessário e as inconsistências cadastrais
(NCM × cClassTrib etc.) apontadas pela própria calculadora.

## Para o usuário final (Windows)

Não precisa de Python, Git nem Java.

1. Baixe `Simulador-RTC-Windows.zip` em [Releases](https://github.com/lucassouzafigueredo/CalculadoraReceita/releases/latest) e extraia.
2. Dois cliques em **Iniciar Simulador.bat**. O simulador abre numa janela própria (Edge ou Chrome);
   ao fechar essa janela a calculadora é desligada automaticamente.
3. Baixe a planilha-modelo na tela, preencha, envie e clique em **Calcular**.
4. **Exportar Excel** gera: Resumo por ano, visões por SKU/cliente/canal/UF/cClassTrib,
   itens detalhados, inconsistências, premissas e metadados da versão da calculadora.

A cada abertura o lançador verifica o último Release e se atualiza sozinho (só a pasta `app`,
~90 MB; o Java embutido é mantido). Tudo roda localmente: a planilha não sai do computador.

## Como fica sempre atualizado com o GitHub da Receita

```
GitHub da Receita ──(todo dia 06:17)──► GitHub Actions deste repositório
                                          │ clona a versão mais recente
                                          │ gera o banco de tabelas e compila
                                          │ testa (cálculo de referência + tela + Windows)
                                          ▼
                                       Release novo ──► lançador nas máquinas se atualiza ao abrir
```

Workflow: `.github/workflows/simulador-rtc.yml`. Só publica se a calculadora oficial
ou o simulador mudaram. Pode ser disparado manualmente em *Actions › Run workflow*.

O repositório é público para que qualquer usuário consiga baixar o pacote e receber as
atualizações sem login. Nenhum dado de planilha é enviado ao GitHub: tudo roda na máquina.

## Só tem a NCM? Descoberta da cClassTrib com racional

No cartão **"Só tem a NCM?"** cole NCMs/NBS (ou envie uma planilha com a coluna `ncm`). Para cada código
o simulador consulta a calculadora oficial e mostra:

1. o cadastro oficial do código;
2. quais cClassTrib com anexo da LC 214 aceitam o código (validador oficial `ncm-aplicavel` /
   `nbs-aplicavel`, a mesma regra do erro REG-011);
3. a sugestão e **por que** foi escolhida (único enquadramento geral, maior redução, ou integral);
4. a base legal (artigo da LC 214 com o texto);
5. as reduções e a conta da alíquota efetiva (2027 e 2033, com as premissas);
6. crédito para o comprador e Imposto Seletivo;
7. **todas as alternativas**, com alíquota e o motivo de não terem sido sugeridas.

Situações: *Automática* (um enquadramento geral), *Revisar* (mais de uma possibilidade — o racional abre
sozinho), *Integral* (fora dos anexos). Benefícios que dependem do comprador (órgão público, diferimento)
nunca são sugeridos sozinhos, só aparecem como alternativa. "Baixar planilha preenchida" gera o modelo com
`cst`/`cclasstrib` preenchidos e as abas `Racional_cClassTrib` e `Alternativas`.

Na planilha de simulação, `cst` e `cclasstrib` vazios também são descobertos automaticamente
(coluna `origem_cclasstrib` no Excel exportado).

## Planilha (aba `Itens`)

Uma linha por item. O mínimo é `ncm` (ou `nbs`) e `valor_produto` (ou `base_calculo`/`receita_bruta`).
O resto tem padrão: `cst`/`cclasstrib` descobertos pela NCM, operação = linha, data = 01/01, local = São Paulo
(com alerta). Informe `uf`, `municipio_ibge`, `cliente`, `canal` para análises por essas dimensões.
Opcionais para análise: `cliente`, `canal`, `custo_total`, tributos atuais (`pis`, `cofins`,
`icms`, `iss`, `ipi`) e Imposto Seletivo (`is_cst`, `is_cclasstrib`, `is_aliquota`).
A aba `Instrucoes` do modelo descreve todas as colunas.

## Metodologia (resumo)

| Item | Origem |
|---|---|
| Base de CBS/IBS/IS por ano | calculadora oficial (`/base-calculo/base-calculo-unificada`) |
| CBS, IBS, IS, reduções, inconsistências | calculadora oficial (`/observabilidade/regime-geral`) |
| Alíquotas 2026 | oficiais da calculadora (teste, compensáveis → não entram como custo) |
| Alíquotas 2027–2033 | premissas editáveis (a lei exige informá-las; a calculadora marca como simulado) |
| Tributos antigos remanescentes | fatores por ano (PIS/COFINS 0 a partir de 2027; ICMS/ISS 90/80/70/60% em 2029–32) |
| Receita líquida, margem, reajuste | preço ao cliente mantido; RL = receita bruta − carga |

Limitações da v1: não considera créditos nas compras nem o efeito "por fora" sobre o preço final.

## Estrutura

```
CalculadoraReceita/
  web/                 tela (HTML/JS, sem build) servida pela própria calculadora
    js/regras.js       regras puras: layout, validação, montagem das requisições, contas
    js/app.js          tela, chamadas à API, gráficos, Excel
  pacote/              lançadores Windows (bat + PowerShell), config.json, LEIA-ME
  .github/workflows/simulador-rtc.yml   verificação diária, montagem, testes e Release
  docs/prompt_simulador_rtc.md          prompt original da ideia (referência)
  scripts/
    montar_pacote.sh   clona a calculadora, compila, testa e gera os zips
    teste_regras.js    testes unitários (node)
    teste_e2e.js       teste de tela com Playwright
```

## Desenvolvimento local

```bash
# com a calculadora oficial compilada (ver README dela), na raiz do repositório oficial:
java -Dspring.profiles.active=offline -jar target/api-regime-geral.jar \
  --spring.web.resources.static-locations=file:/caminho/CalculadoraReceita/web/ --management.server.port=-1
# abra http://localhost:8080/api/simulador.html
node scripts/teste_regras.js
node scripts/teste_e2e.js http://localhost:8080/api/simulador.html
```
