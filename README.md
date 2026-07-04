# 🟡 Jogo dos Pontos — estilo Eurosport (Tour de France 2026)

Aplicação web para jogares, com os teus amigos, o **jogo dos pontos / jogo das apostas** tal como os
comentadores do Eurosport Portugal (Paulo Martins, Luís Piçarra, Olivier Bonamici) fazem durante o Tour.

Cada jogador aposta num ciclista por etapa. A tua pontuação é a **posição** em que o teu ciclista termina.
**Ganha quem tiver MENOS pontos** (estilo golfe). Acertar no vencedor da etapa vale um bónus de **−50**.

## 📋 Regras implementadas

| Regra | Detalhe |
|------|---------|
| Aposta | 1 ciclista por etapa, antes da hora-limite |
| Pontuação | = posição final do ciclista na etapa (7.º lugar → 7 pontos) |
| Objetivo | **menos pontos = melhor** |
| Bónus | **−50** por acertar no vencedor (1.º lugar → `1 + (−50) = −49`) |
| Repetição | não podes repetir o mesmo ciclista na **mesma semana** (etapas 1–9, 10–15, 16–21), e há um limite total (por defeito 2) |
| Penalização | falhar a aposta / ciclista que abandonou → **pior jogador da etapa + 50** |
| Classificação geral | soma dos pontos; **desempate** por mais vitórias de etapa, depois mais 2.ºs lugares, etc. |

As regras ambíguas entre fontes (limite de repetições, valor do bónus, margem da penalização) são
**configuráveis** no painel de administrador de cada jogo.

## 🎮 Como se joga

1. **Criar um jogo** — dás-lhe um nome e recebes um **código de sala** (ex: `Q9E4Z`). Ficas administrador.
2. **Convidar amigos** — partilhas o link (`?code=Q9E4Z`) ou o código. Cada amigo entra com o seu nome.
3. **Administrador importa a startlist** — botão para buscar automaticamente ao ProCyclingStats, ou cola a lista à mão.
4. **Cada etapa** — os jogadores escolhem um ciclista antes do fecho. As apostas são secretas até a etapa fechar.
5. **Resultados** — o administrador fecha a etapa e introduz a ordem de chegada (auto ou manual). A pontuação é calculada automaticamente.
6. **Classificação geral** — atualizada ao longo das três semanas. Menos pontos vence.

## 🚀 Correr localmente

```bash
npm install
npm start           # arranca em http://localhost:3000
```

Outros comandos:

```bash
npm test            # testes do motor de pontuação
npm run seed:demo   # cria um jogo de demonstração já pontuado
```

## 📱 Publicar grátis pelo telemóvel (Render) — passo a passo

Dá para publicar um link público **usando só o browser do Android/iPhone**, de graça:

1. No browser, vai a **[render.com](https://render.com)** → **Get Started** → **Sign up with GitHub** e autoriza o acesso ao repositório `jogodospontos`.
2. No painel do Render: **New +** → **Blueprint**.
3. Escolhe o repositório **`jnuno2000/jogodospontos`**.
4. Em **Branch**, escolhe **`claude/eurosport-points-game-5v2yuw`** (é o branch que tem o código e o `render.yaml`).
5. O Render lê o `render.yaml` (plano **Free**, imagem leve). Confirma em **Apply / Create**.
6. Espera o build terminar (a 1.ª vez pode demorar ~3–5 min). No fim tens um link tipo `https://jogo-dos-pontos.onrender.com`.
7. Abre esse link, cria o jogo e partilha o **código da sala** (ou o link `?code=...`) com os amigos. 🎉

> **No plano gratuito:** o serviço **adormece** após ~15 min sem uso (a primeira visita a seguir demora ~1 min a acordar), os **dados são efémeros** (podem apagar-se ao adormecer) e o **auto-fetch do PCS está desligado** — introduz os resultados de cada etapa **à mão** no painel de Admin (é rápido: colas a ordem de chegada). Para guardar os dados durante as 3 semanas do Tour, passa a um plano pago com disco (ver secção Docker abaixo) ou liga um Postgres externo.

## 🌐 Publicar online (jogar à distância)

A app é um único processo Node (serve a API e o frontend), fácil de publicar.

- **Docker (com auto-fetch)** — incluído `Dockerfile` (base Playwright, com Chromium):
  ```bash
  docker build -t jogo-dos-pontos .
  docker run -p 3000:3000 -v $(pwd)/data:/app/data jogo-dos-pontos
  ```
- **Render / Fly / Railway** — usa o `render.yaml` (Blueprint) ou o `Dockerfile`.
  Monta um **disco persistente** em `/app/data` para não perderes os jogos entre deploys.

Variáveis de ambiente úteis:

| Variável | Descrição | Defeito |
|----------|-----------|---------|
| `PORT` | porta HTTP | `3000` |
| `DATA_DIR` | pasta da base de dados SQLite | `./data` |
| `RACE_SLUG` / `RACE_YEAR` | prova a consultar no PCS | `tour-de-france` / `2026` |
| `CHROMIUM_PATH` | caminho do Chromium (se o Playwright não o encontrar) | — |

> **Persistência em free-tier:** alguns planos gratuitos apagam o disco a cada deploy. Se precisares de
> persistência garantida, aponta a app para um Postgres gerido (ex: Neon/Supabase) — a camada de dados
> está isolada em `server/db.js` para facilitar essa migração.

## 📡 Fonte de dados (auto + fallback manual)

Não existe uma API oficial e gratuita de resultados do Tour em tempo real. A app usa **best-effort**:

- **Automático:** `server/providers/pcs.js` abre o [ProCyclingStats](https://www.procyclingstats.com)
  com um browser headless (Playwright/Chromium) e lê a startlist e os resultados de cada etapa.
  O PCS bloqueia pedidos HTTP simples e pode mudar de estrutura, por isso isto pode falhar.
- **Manual (garantido):** o administrador pode sempre introduzir/corrigir a startlist e a ordem de
  chegada à mão. O botão "buscar automaticamente" apenas **preenche** os campos, que confirmas antes de gravar.

## 🧱 Arquitetura

```
server/
  index.js         Express: API + ficheiros estáticos
  db.js            SQLite (schema, migrações, seed das 21 etapas)
  scoring.js       Motor de pontuação (funções puras) — com testes
  service.js       Regras com estado (validação de apostas, pontuar etapas, classificação)
  tour2026.js      Calendário oficial do Tour 2026
  routes/          Rotas públicas (jogadores) e de administrador
  providers/       Fonte de dados (ProCyclingStats)
public/            Frontend SPA (HTML/CSS/JS vanilla, sem build)
test/              Testes do motor de pontuação
scripts/           Seed de demonstração
```

## 🔒 Notas

- **Administrador** = quem cria o jogo (guarda um token secreto no browser). Só ele pode importar
  startlist, fechar etapas e introduzir resultados.
- **Jogadores** entram com o código da sala e um nome; a sua identidade fica guardada no browser.
- Feito para jogar entre amigos — sem contas nem palavras-passe.

---

Feito com ❤️ para os fãs do ciclismo e das tiradas dos comentadores do Eurosport.
