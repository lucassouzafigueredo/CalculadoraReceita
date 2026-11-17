# Prompt — Simulador da Reforma Tributária (CBS/IBS/IS)

Copie todo o bloco abaixo e cole no chat do agente do VS Code (Claude Code, Copilot Chat em modo Agent ou similar), com a pasta do projeto aberta.

---

```
Você é um engenheiro de software sênior e especialista em tributação sobre consumo no Brasil.
Crie um projeto completo chamado "simulador_rtc" em Python: um simulador de impacto da Reforma
Tributária (LC 214/2025) que usa como motor de cálculo a calculadora OFICIAL da Receita Federal:
https://github.com/ReceitaFederal/calculadora-rtc-regime-regular

## 1. Objetivo
Um app web local (Streamlit) em que o usuário:
1. Baixa uma planilha-modelo padrão (.xlsx);
2. Preenche com os itens de venda/compra e sobe a planilha no app;
3. O app valida os dados, envia para a API da calculadora oficial, e mostra:
   - CBS, IBS (UF e Município) e Imposto Seletivo por item, por SKU, cliente, canal, UF e total;
   - Comparativo carga atual (PIS/COFINS/ICMS/ISS informados) x carga nova;
   - Impacto em receita líquida e margem bruta (R$ e p.p.);
   - Indicadores de crédito retornados pela API;
   - Lista de inconsistências por item (código de erro, campo, descrição);
4. Exporta um Excel de resultados (abas: Resumo, Itens, Comparativo, Erros, Metadados).

## 2. Sincronização OBRIGATÓRIA com o GitHub oficial (requisito crítico)
A calculadora oficial é atualizada com frequência (tabelas de cClassTrib, NCM, alíquotas, regras).
O simulador SEMPRE deve rodar sobre a última versão. Crie o módulo `motor/sync_calculadora.py` que,
toda vez que o app iniciar (e também por um botão "Verificar atualizações" na barra lateral):
1. Se a pasta `motor/calculadora-rtc-regime-regular` não existir: `git clone` do repositório oficial.
2. Se existir: `git fetch` + compara o commit local com `origin/main`. Se houver diferença:
   `git pull`, regenera o banco e recompila:
     - mkdir -p ./calculadora/db
     - ./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf --batch-mode --errors
       (no Windows: mvnw.cmd ... flyway\flyway-pro.conf)
     - ./mvnw clean package -DskipTests
3. Para a API antiga (se estiver rodando) e sobe a nova:
     java -Dspring.profiles.active=offline -jar target/api-regime-geral.jar
   rodando a partir da raiz do repositório clonado (o banco é lido em ./calculadora/db/calculadora-pro.db).
4. Aguarda a API responder (health check em http://localhost:8080/api, timeout configurável).
5. Registra em `motor/versao.json`: commit hash, data do commit, versão mais recente do CHANGELOG.md
   e data/hora da sincronização. Exibe isso na barra lateral do app e grava na aba "Metadados" do Excel exportado
   (rastreabilidade: todo resultado precisa dizer com qual versão da calculadora foi calculado).
6. Mostra no app as novidades do CHANGELOG.md desde a última versão sincronizada.
7. Se não houver internet, usa a versão local já existente e exibe um aviso claro.
8. Verifica pré-requisitos (Java 21+, Git) e dá mensagem amigável se faltar.
Deve funcionar em Windows (prioritário) e Linux. Crie também `iniciar_simulador.bat` que sincroniza
e abre o app.

## 3. Uso da API (não reimplementar regra tributária em Python!)
Toda a lógica tributária vem da API oficial. Base: http://localhost:8080/api/calculadora
Swagger: http://localhost:8080/api/swagger-ui.html — leia o `docs/exemplos.md` e o código em
`src/main/java/br/gov/serpro/rtc/api/model/input/` do repositório clonado para confirmar o contrato
JSON exato (OperacaoInput, ItemOperacaoInput, AliquotasNominaisInput, ImpostoSeletivoInput) e
adapte o mapeamento caso os campos mudem em versões futuras.
- Cálculo: POST /observabilidade/regime-geral (não para no primeiro erro; erros vêm por item).
  Verificar `estadoItem` de cada item: CALCULADO, CALCULO_SIMULADO, INCONSISTENCIA_ENTRADA,
  NAO_IMPLEMENTADO, FALHA_TECNICA. A resposta é HTTP 200 mesmo com erros.
- Descrição de erros: GET /observabilidade/erros?codigo=XXX
- Validação prévia e listas suspensas: GET /dados-abertos/situacoes-tributarias/cbs-ibs,
  /dados-abertos/classificacoes-tributarias/..., /dados-abertos/ncm, /dados-abertos/nbs,
  /dados-abertos/aliquota-uniao, /aliquota-uf, /aliquota-municipio.
- Regra importante: a partir de 2027 `aliquotasNominais` é obrigatório; antes de 2027 é proibido.
  O app deve tratar isso automaticamente conforme a data do fato gerador.
- Usar `dhFatoGerador` (não usar `dataHoraEmissao`, que está obsoleto).
- Agrupar as linhas da planilha por `id_operacao` para montar cada operação (cabeçalho + itens).
- Enviar em lotes, com barra de progresso, retry e cache local de respostas (hash do payload).

## 4. Planilha-modelo padrão (gerar `modelo/modelo_simulador_rtc.xlsx` via openpyxl)
Aba "Instrucoes": explicação de cada campo, exemplos e regras.
Aba "Tabelas": listas de CST, cClassTrib e UFs carregadas da API (para validação de dados no Excel).
Aba "Itens" (uma linha por item), colunas:

| Coluna | Obrig. | Tipo | Descrição |
|---|---|---|---|
| id_operacao | Sim | texto | Agrupa itens da mesma nota/operação |
| data_fato_gerador | Sim | data (AAAA-MM-DD) | Define o ano/regra de transição |
| uf | Sim | texto(2) | UF de destino |
| municipio_ibge | Sim | número(7) | Código IBGE do município |
| numero_item | Sim | inteiro | Sequencial dentro da operação |
| sku | Sim | texto | Código do produto/serviço |
| descricao | Não | texto | Descrição |
| cliente | Não | texto | Para análise por cliente |
| canal | Não | texto | Para análise por canal |
| ncm | Cond. | texto(8) | Obrigatório para mercadorias |
| nbs | Cond. | texto(9) | Obrigatório para serviços |
| cst | Sim | texto(3) | CST CBS/IBS |
| cclasstrib | Sim | texto(6) | Classificação tributária |
| quantidade | Sim | decimal | |
| unidade | Sim | texto | KG, UN, LT... |
| base_calculo | Sim | decimal | Valor da base CBS/IBS (R$) |
| aliq_cbs | Cond. | % | Obrigatório a partir de 2027 (vazio = usar referência da API) |
| aliq_ibs_uf | Cond. | % | Idem |
| aliq_ibs_mun | Cond. | % | Idem |
| is_cst | Não | texto(3) | Só se houver Imposto Seletivo |
| is_cclasstrib | Não | texto(6) | Idem |
| is_base_calculo | Não | decimal | Idem |
| is_aliq_ad_valorem | Não | % | Idem |
| receita_bruta | Sim | decimal | Para DRE |
| custo_total | Não | decimal | Para cálculo de margem |
| atual_pis | Não | decimal (R$) | Carga atual, para o comparativo |
| atual_cofins | Não | decimal (R$) | |
| atual_icms | Não | decimal (R$) | |
| atual_iss | Não | decimal (R$) | |
| atual_ipi | Não | decimal (R$) | |

Incluir 5 linhas de exemplo baseadas no docs/exemplos.md (arroz cesta básica, cerveja com IS,
serviço de educação, um item comum e um item com erro proposital).
O botão "Baixar modelo" no app deve sempre gerar o modelo com as tabelas atualizadas da API.

## 5. Validação antes do envio (camada Python, com pandas + pydantic)
- Colunas obrigatórias, tipos, formatos (NCM 8 dígitos, NBS 9, IBGE 7, CST 3, cClassTrib 6);
- NCM/NBS e CST/cClassTrib existentes nas tabelas da API;
- Item com NCM e NBS vazios ao mesmo tempo; datas inválidas; valores negativos;
- Resultado: relatório de erros por linha (linha da planilha, coluna, mensagem), permitindo
  baixar a planilha com os erros destacados, e opção de "calcular apenas linhas válidas".

## 6. Cenários e análises (visão FP&A)
- Seletor de ano(s) de simulação (2026 a 2033) para recalcular a mesma base em cada ano da transição,
  sobrescrevendo a data do fato gerador; gráfico de evolução da carga por ano.
- Ajuste de sensibilidade: alíquotas alternativas (cenários Base, Otimista, Pessimista).
- Preço de equilíbrio: preço necessário para manter a margem bruta atual por SKU.
- Visões: carga efetiva % por SKU/cliente/canal/UF, ranking dos maiores impactos (top 20),
  waterfall da receita bruta até a receita líquida (atual x novo), cards de KPIs.
- Usar plotly para gráficos.

## 7. Estrutura do projeto
simulador_rtc/
  app.py                      # Streamlit (páginas: Início, Modelo, Upload & Validação, Resultados, Cenários, Sobre/Versão)
  motor/sync_calculadora.py   # clone/pull/build/start/health/versão
  motor/api_client.py         # cliente HTTP (requests), retry, cache
  dados/modelo.py             # geração da planilha-modelo
  dados/validacao.py          # validação pydantic/pandas
  dados/mapeamento.py         # planilha -> JSON da API e resposta -> DataFrame
  analise/comparativo.py      # atual x novo, margem, preço de equilíbrio, cenários
  analise/exportacao.py       # Excel de resultados formatado
  tests/                      # pytest: mapeamento, validação e um teste de integração com a API
  config.yaml                 # porta, URL do repo, branch, timeouts
  requirements.txt
  iniciar_simulador.bat
  README.md                   # passo a passo de instalação e uso em português

## 8. Qualidade
- Código em português nos nomes de negócio, com type hints e docstrings.
- Logs em arquivo (logs/simulador.log).
- Nunca alterar o código do repositório oficial clonado; ele é somente leitura (apenas pull).
- Tratar arredondamentos com Decimal.
- Ao final: rode os testes, suba a API, processe a planilha-modelo de exemplo e mostre que o resultado
  bate com o exemplo de docs/exemplos.md (ex.: serviço de educação com base 1200,00 ⇒ CBS 42,24 com redução de 60%).

Comece verificando os pré-requisitos (Python 3.11+, Java 21+, Git), depois implemente na ordem:
sync_calculadora → api_client → modelo → validação → mapeamento → app → análises → testes → README.
```
