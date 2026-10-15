# Operator workspace

## Notificações do atendente — 2026-10-15

Entrada compacta e dispensável sob os filtros da fila, com a mesma porta permanente em Configurações › Notificações. A permissão nativa só é solicitada no clique. Estado de permissão e inscrição não são confundidos: inscrição confirmada, bloqueio, servidor sem configuração e falha recuperável têm textos e próximos passos próprios. Usa tokens e botões existentes; não adiciona consulta na renderização inicial do Inbox.

Sistema Vivo: entrada = OperatorNotificationPrompt + useNotificationPermission; saída = syncPushSubscription → API existente de inscrição autenticada/auditada. Eventos existentes message.received e central.aviso_criado alimentam o worker; clique retorna à conversa/Central e mantém controle de acesso. Anti-silêncio = erro visível, retry e diagnóstico de configuração. Não altera decisões da IA ou regras de destinatários. Mapa: notificacoes-operador.architecture.json. Na produção conferida, o par VAPID ainda está ausente; implementação local não é confirmação de entrega real nem publicação na VPS.

Validação: 122 testes focados em 20 arquivos passaram; typecheck passou; lint sem erros (um aviso de efeito já existente em InboxLayout). Controle negativo ignorando o resultado do PUT reprovou os dois testes de HTTP 401/503; restaurado e verde. Conferência visual local do botão na fila concluída. Entrega nativa com a aba fechada em produção ainda não testável sem configurar o servidor e inscrever o navegador.

## Resposta citada no web — 2026-10-15

Menu existente de mensagens → Responder citando → prévia com cancelamento → bloco de autor/horário/trecho na resposta. Componente de citação compartilhado entre Inbox e portal público; mantém foco no editor após selecionar pelo menu. Nota interna e troca de sessão removem a seleção. No erro, rascunho, citação e chave idempotente são preservados para retry. Gravação resolve o conteúdo no servidor, limitada à mesma organização/conversa/sessão, em transação com o envio existente. O mesmo enriquecimento de leitura expõe apenas o bloco validado aos dois públicos.

Sistema Vivo: entrada = mensagem selecionada em WebchatOperatorPanel; persistência = metadata.webchat_reply via fn_responder_mensagem_webchat_operador; consumidores = enriquecerMensagensWebchat, CitacaoWebchat na Inbox e PortalDeAtendimento. Mantidos auditoria webchat.operator_message_sent, evento de resposta/push e verificações de sessão/encerramento do envio existente. Falhas aparecem no editor com retry; cancelar citação e reabrir sessão permanecem caminhos explícitos. Sem configuração nova ou transporte externo; mapa de webchat atualizado no mesmo trabalho.

Validação: 44 testes unitários focados, 9 invariantes em Postgres efêmero, typecheck e lint passaram. Baseline aplicado como instalação e reaplicado como atualização. Teste de controle removendo o ID da citação do envio fez a suíte reprovar; restaurado e verde. Conferência real em localhost: visitante iniciou → operador citou/respondeu → visitante recebeu → ambos recarregaram e mantiveram a citação; portal conferido em 390px sem overflow horizontal. Anonimização remove o trecho copiado. Evidências ficam fora do repo em .codex/artifacts. Trabalho local, sem publicação na VPS.

## Histórico único — 2026-10-15

Pedido do usuário: Fechadas e Arquivadas tornam-se Encerrados. A navegação e visão geral abrem um único filtro SQL para closed/archived, com paginação existente e sem mover/apagar registros. Links antigos de arquivadas são normalizados. Encerrar usa o fechamento auditado existente e Reabrir funciona nos dois estados; os dois ficam somente leitura até reabertura. A soma das contagens usa as consultas existentes e mantém compatibilidade da API v1.

Sistema Vivo: entrada = status persistido em conversations, saída = listagem/contagem do Inbox; mutação = close/reopen e auditoria já existentes. Porta = Encerrados, continuidade = Reabrir e entrada de novas mensagens pelo fluxo existente. Sem configuração nova, schema ou worker. Falhas usam os tratamentos existentes e recarregamento do cache. Alteração de uma vista existente, sem novo nó de arquitetura.

## Conversation refinement — 2026-10-13

- User screenshots supersede phase 3's full desktop action row. Use a single portal
  for the existing service controls into the fixed inspector footer at 1280px;
  retain inline controls on smaller viewports. Dialogs and mutations stay owned by
  ConversationHeader; no duplicate control instances or new business rules.
- Compact the contact avatar and header. Web channel description remains accessible;
  the session selector appears for multiple sessions or an ended session.
- Existing tokens, theme and UI primitives retained. 21st CLI unavailable locally.
- Living-system scope: presentation only, no schema, API, routing or permissions changes.
- Validation: header/web component tests, typecheck, existing public-web E2E including
  reply, private note, dialogs, responsive layouts and light/dark accessibility.
  Initial E2E run hit an unrelated queue-count setup race; repetition passed.

## Phase 8 — final polish and regression

Completed locally on 2026-10-13. The first browser regression reproduced missing focus return from keyboard help, low-contrast selected-row timestamps, invalid nested description-list markup in service metadata and a hidden editor at 320×568. The dark-theme accessibility pass also caught outgoing timestamps at 4.4:1. Fixes preserve the original controls: controlled help captures its opener and restores focus on close, metadata uses direct dt/dd pairs, time labels use stronger existing text tokens, and short mobile headers scroll within a bounded area so the transcript and editor retain space. No actions are removed. Existing desktop/normal-height mobile layout is unchanged.

Validation: 359 tests across 50 files passed (composer, inbox filters/counts, resizable panes, contact demands, messages, home, permissions, webchat and i18n). Two local Chromium journeys passed: public visitor → Inbox reply → private note absent for visitor → cancel dialogs → close service; and attendant/sector association → queue transfer → filter. New assertions cover help focus restoration, 320×568 editor visibility, at least 100px of transcript and keyboard access to the scrolling header's Transfer action. Axe WCAG A/AA scans of the populated Inbox passed in light and dark themes. Responsive coverage also includes 390×844, 768×1024, 1280×800, 1440×900 and 1920×1080. Guarded local build and 8GB typecheck passed. Targeted lint: zero errors, three existing CRMSidePanel effect warnings. 21st review retains deliberate theme-token definitions and user-triggered autofocus, not unexplained new component colors.

Living System Checklist: source = existing conversation and service metadata; consumers = scoped workspace CSS, CRMSidePanel and ShortcutsHelpDialog. Entry remains /app/inbox; data queries, permission boundaries, mutation audit, organization branding, retry/error handling and human/AI handoff are untouched. No backend route, architecture node, background process, configuration or learning loop is introduced. The eight UI phases are complete locally, not a declaration that every CRM integration is production-certified. No live WhatsApp, IXC/Bemobi operation, Safari/Firefox or physical-device keyboard was tested in this phase. Local test infrastructure still logs known missing platform branding column, disabled external services and cleanup/navigation warnings; these do not constitute a clean production health audit. Evidence remains outside the repository under /tmp/livecrm-ui-web. No commit, push or VPS deployment in this phase.

Final manual browser check: reloaded the local Chrome preview after the build, signed into the existing preview account, confirmed /app/inbox and its real empty state, opened keyboard help, closed with Escape and verified focus returned to its opener. No blank page, framework overlay or browser console warning/error was observed. Browser control was available through CUA; existing Playwright tests provide repeatable populated-state regression. Preview server remains at http://127.0.0.1:3001/app/inbox.

## Phase 7 — composer and dialogs

Both operator transports now share ComposerModeSwitch, a presentation-only reply/note selector with canonical ChatCircle/Lock icons, pressed state and persistent team-only note context. The editor groups installed attachment/emoji controls, growing textarea and send/audio controls on one compact neutral surface. DOM/tab order is preserved. Mobile controls have larger touch targets. The clone's compact composer is the visual reference; intentionally retain CRM's internal notes, templates, mentions, audio, attachment preview, pending/failed-send and AI-review features instead of replacing them with the clone's simple demo input. No web attachment/audio capability is invented.

Transfer, contact sharing, attachment preview, keyboard help and conversation confirmations opt into a scoped dialog class with consistent title/body/action spacing, bounded viewport height and overflow. Radix focus management, Escape, cancellation, destructive styling and pending/disabled conditions remain canonical. Attachment preview describes the destination captured at file selection, not the current editor mode. Long document names wrap. Public webchat and global dialog primitives are unchanged. 21st search could not authenticate; reused installed primitives only. Existing token definitions flagged by review are intentional reference-theme tokens, not new component colors.

Living System Checklist: sources = each transport's existing composer state, pendingEm and canonical conversation mutations; consumers = shared mode presentation, scoped CSS and opted-in dialogs. Entry = existing /app/inbox conversation composer/actions. Records/audits, retry states, channel separation, permissions, organization accent/theme and human/AI transitions are unchanged. No backend route, mutation, background process, configuration, architecture node or learning loop is introduced. Private note media still uses its existing destination and does not enter client messaging. Remaining phase: 8 final polish/regression. Local preview only; no git push or VPS deployment.

Validation: 68 focused composer/header/webchat unit tests, 26 i18n checks, the guarded local build, 8GB-heap typecheck and both local Chromium journeys passed. Browser review after reloading the local build showed the keyboard dialog correctly, no blank page/framework overlay and no console warnings/errors. Automated journeys verify client reply, private note save with Enter, newline with Shift+Enter, note absence on the customer side, sector transfer, cancellation and transfer-focus return. The last check initially revealed that the controlled transfer dialog had no trigger to restore focus to; an optional trigger ref now restores it in ConversationHeader without changing transfer execution. Desktop 1280/1440/1920, tablet 768 and mobile 390px were checked in light/dark contexts; screenshots 16–18 under /tmp/livecrm-ui-web document the note editor, transfer and mobile confirmation. Four pre-existing lint warnings remain (attachment blob img and state-reset effects), zero lint errors. No live WhatsApp transmission or IXC/Bemobi operation was tested or changed.

## Phase 6 — operator start

Live OPA home was inspected read-only on 2026-10-13: a compact heading, actionable count cards and larger analytics panels. The CRM adopts the count-card hierarchy, slate/light surfaces and compact spacing, not OPA's unsupported metrics or assets. InboxHome replaces the unselected conversation/contact area; the existing queue stays visible and resizable. Four shortcuts read useConversationCounts with the canonical RLS scope (Fila, Minhas, Automático, Fechadas), with no auxiliary filters, daily claims or sum of overlapping views. Their callbacks clear the auxiliary filters and focus the actual queue search. Pending/absent counts show a dash; failed refresh hides old counts and exposes retry. No fictitious online status, satisfaction graph, wait time or automatic claim action.

Search focuses the existing input; keyboard help opens ShortcutsHelpDialog. The existing Conversas return action is now available on desktop too, restoring the start view without closing the service. Selected deep links keep loading/error/not-found states rather than briefly pretending to be the home. On mobile the queue remains the initial screen, preserving one-pane navigation and the contact sheet; no duplicate dashboard is mounted. Light/dark tokens and organization accent remain canonical. 21st search required unavailable authentication, so only installed components and icons were used.

Living System Checklist: source = useConversationCounts and AuthProvider; consumers = InboxHome and the existing InboxLayout filters/list. Entry = /app/inbox without a selected id. No mutation, API, audit, configuration, architecture node, IA transition or learning loop is added. Count refetch/retry remains in the canonical query; the existing realtime list owns new work. Remaining phases: 7 dialogs/composer, 8 polish/regression. Local preview only; no production deployment.

Validation: 90 focused unit checks and two local Playwright journeys passed (webchat end-to-end and sector routing). Coverage includes pending/error/legacy counts, retry, keyboard activation, immediate search reset before debounce, deep links/history, permissions on existing tabs and resize handles with/without a selected conversation. Desktop light/dark, tablet and 390px queue/selected chat were checked; no runtime page errors or HTTP 5xx in the web journey. Visual evidence lives outside the repository under /tmp/livecrm-ui-web. The explicit search reset version cancels pending typed input without remounting the filters. Existing lint/review warnings on resize effect and user-initiated search autofocus are unchanged.

## Phase 5 — contact inspector

The existing CRMSidePanel now presents a centered identity with the authorized avatar when one exists (initials otherwise), phone copy with success/failure feedback, compact IXC association, full-width Ver contato and agenda actions, and smaller tag/lead actions. Service metadata comes only from the loaded conversation: actual service_started_at or explicitly labelled conversation creation date, channel, assigned human and existing sector badge. No synthetic OPA protocol, dashboard, block action or duration is introduced.

Open demands and conversation tags remain on the main surface. Empty memory/leads/orders/activity sections collapse with native details; populated working sections and loading errors open, keeping retries available. Enrichment moves below operational sections, and the acervo remains reachable in its own disclosure. Native summary works with keyboard, the existing mobile contact sheet is preserved, and wrapped names/buttons respect narrow columns. This deliberately preserves CRM capabilities rather than removing them to match OPA. 21st search again required unavailable authentication; all primitives are local.

Living System Checklist: source = InboxLayout conversation/contact and existing crm-summary; consumers = CRMSidePanel, VinculoIxcDoContato, canonical tag/lead/demand editors. Entry remains /app/inbox desktop inspector/mobile Ficha. Copy is local clipboard only and needs no backend audit; all mutation routes/audit remain unchanged. Brand/theme are the existing settings. No new pending state, background action, IA handoff rule, anti-death or learning loop is added; error/retry and existing demand next-step actions are preserved. No new architecture node. Remaining phases: 6 operator home, 7 dialogs/composer, 8 polish.

## Phase 4 — messages

MessageFrame presents both operator threads with an external decorative avatar and recorded sender above the bubble. MessageBubble retains its canonical origins (IA, automation, external device, integration, own user versus colleague). Contact names come from the loaded InboxLayout contact; group sender wins over that fallback. Webchat uses its recorded sender_name, not the current assignee and not an unconditional Você. Unknown humans are Atendente. Timestamps remain inside the bubble as semantic time elements; webchat does not invent read receipts.

Reference ledger: OPA's external avatar/name and compact bubbles are adopted; local UserCircle/Robot icons replace its silhouette assets. Round corners are 8px with the sender-side top corner reduced. Maximum width is 760px/82%, widening on mobile with 24px avatars. Existing attachment components keep controls/download routes; document/audio widths now shrink to the bubble. Web PDFs previously visible only to the visitor now have a DocumentCard in the operator view, using the same extracted HTTPS/PDF guard. Public rendering is unchanged.

Living System Checklist:
1. Source: InboxLayout contact, Message records from useMessagesRealtime, and MensagemWebchat from the existing session API.
2. Consumer: MessageFrame inside MessageBubble and WebchatOperatorPanel; MediaRenderer/DocumentCard retain media access.
3. Record: no new mutation; existing message send/edit/delete audit unchanged.
4. Screen: /app/inbox conversation timeline, both transports, plus existing MessageBubble consumers.
5. Entry: existing conversation list, no new route.
6. Anti-death: none needed for read-only presentation; pending/failed messages and existing follow-up are untouched.
7. Configuration: existing organization brand and user light/dark theme; unknown sender gets an honest fallback.
8. Continuity: existing human/AI authorship, notes and handoff cards remain distinct; no routing changes.
9. Error loop: canonical failed-send/media-unavailable feedback and actions remain; no new background process.
10. Map: no new architectural node, shared presentation component only.

Validation uses the local .env.e2e build and disposable E2E organization. No production update or real WhatsApp transmission is included. Remaining phases: 5 contact panel, 6 operator home, 7 dialogs/composer, 8 final polish.

## Phase 3 — conversation header

Identity now has a dedicated top row (initials, name, lifecycle status, channel, phone, sector and canonical OwnerBadge). Search/voice/video remain in a separate, labelled reading-tools group. The existing service actions occupy a second wrapping row with canonical icons and unchanged labels, pending states, permissions, hooks and confirmation dialogs. This intentionally retains visible actions instead of copying OPA's hidden menus. Long names truncate with their full title; narrow columns wrap without pushing the contact panel offscreen.

Connectivity checklist: InboxLayout/ChatThread → ConversationHeader → existing claim/release, reassign, snooze, close/archive/reopen and AI hooks. Their API audit, invalidation, errors and IA↔human transitions are unchanged; no new business state, endpoint or background action. Entry remains /app/inbox; brand/theme remain configured in existing settings. Presentation requires no anti-death mechanism or learning loop; the existing mutations still own those effects. No new architecture node or extension is introduced: this is a presentation change to the core inbox. Remaining phases: messages, contact panel, operator home, secondary dialogs/composer and final polish.

## Live-reference pass — phases 1 and 2

The live OPA operator view, inspected read-only on 2026-10-13, supersedes the clone where they differ. Implemented in this pass: vertical queues in the desktop rail, a full menu through expansion, TopBar controls docked in the rail, collapsible filters with an active count, and text-first queue rows. Public pages and business rules are unchanged. The remaining phases are conversation header, message visuals, contact panel, initial overview, auxiliary dialogs and final polish; none is declared complete by this pass.

Reference mismatch ledger: OPA has four operational queue shortcuts; LIVE CRM keeps its six existing permission-filtered views. OPA's protocol is not fabricated for CRM rows whose current list payload has none. Brand, fonts and chat wallpaper still follow the previous local pass, pending their own stage.

Connectivity: `InboxLayout` owns filters → `InboxFilters` consumes existing counts and emits the same `onChange` → list queries and URL filters remain unchanged. `InboxRailProvider` only moves presentation through desktop slots in `Sidebar`; it has no query, mutation or stored business state. `TopBar` owns its original alert/search components. Mobile and standalone rendering fall back to the original positions. No new backend event or audit is needed for read-only layout; assignment, handoff and message auditing are untouched. Failed checks are fixed before publishing; no production rollout occurs in this pass.

The UI reference is the user-provided OPA Suite clone, not its backend.

- Compact, expandable navigation rail. Preserve saved expanded preferences.
- Queue switchboard exposes every permitted queue and its real count.
- Independent list, conversation and contact scrolling; existing column resize and mobile sheet stay intact.
- Cool neutral surfaces with the organization's existing accent and contrast-aware brand tokens.
- Local system typography; no external fonts or new component library.
- All business actions, hooks, permissions, integrations and public pages stay with LIVE CRM.

Visual changes live in `app/app/_components/workspace.module.css`; the scope disappears when the authenticated shell unmounts. Regression evidence is captured outside the repository by `tests/e2e/webchat-entrada-publica.spec.ts`.

## Reference alignment

The full local reference is now available at `OPASUITE ENG REVERSA/opasuite-clone/src/styles.css` and `src/App.tsx` (demo rendered 2026-10-13). The second pass uses its 351px queue / 347px contact proportions on wide screens, 320px side panels on notebooks, 32px dotted chat background, slate message surfaces, flatter contact profile and denser queue navigation. The global CRM toolbar, all actions and filters remain deliberately present; the reference's orange is not copied. Screenshots: `/tmp/opa-reference-chat.png` versus `/tmp/livecrm-ui-web/07-operador-escuro.png`.

- Reference: 62px icon rail and dark slate surfaces. Rendered: existing 64px expandable rail with the reference's neutral surface family; 64px preserves the CRM layout and spacing tokens.
- Reference: queue, active, virtual-agent and finished sections. Rendered: the CRM's six permission-filtered queues in a compact switchboard. Keep their actual meanings, live counters and keyboard behavior rather than introducing parallel filters.
- Reference: center conversation with a right contact profile. Rendered: existing resizable columns with wider defaults, enlarged profile initials and IXC link, with contact details in the existing sheet on mobile.
- Intentional differences: organization-controlled accents instead of the clone's orange; local system font instead of adding Inter; no OPA routes, API calls, assets or business rules.
# 2026-10-14 — Paleta da conversa

Pedido explícito: aproximar também as cores do OPA, principalmente a conversa com o cliente. No Inbox, ações violeta sobre superfícies azul-grafite e balões cinza-azulados no tema escuro; textos de destaque/foco usam violeta mais claro para manter contraste. Tema claro e alternância preservados. A decisão substitui a retenção do accent da marca **somente no Inbox montado**, incluindo portais. Não altera configuração de marca, login, portal público, lógica ou recursos de web/WhatsApp. Implementação apenas em CSS, sem dependências, fontes remotas ou assets do OPA.
