# Inatividade no atendimento automático

Configuração em **Configurações → Distribuição de atendimento**, seção “Encerrar atendimento da IA por falta de resposta”. Desligada por padrão. Cada organização define o prazo para perguntar e o prazo adicional antes de encerrar. Na LIVE foi solicitado 15 + 15 minutos.

A varredura do `followup-flow-worker` ocorre a cada minuto. Conta da última resposta da IA efetivamente enviada no episódio atual; o segundo prazo só começa no recibo do lembrete. O prazo prometido é preservado no aviso mesmo se a configuração mudar. Sem recibo, não encerra. O encerramento informa falta de resposta e protocolo, nunca presume solução ou pagamento.

Cliente respondeu, humano assumiu, episódio mudou, IA ainda está trabalhando ou há follow-up ativo: a decisão é cancelada. Conversas na fila humana não participam. Um novo envio da IA inicia outra contagem. A entrega revalida o estado antes do transporte. Webchat recebe avisos de sistema transacionais. Desligar a configuração impede novos avisos e encerramentos.

## Living System Checklist

- Entrada: `acompanharInatividade` no cron existente, mensagens enviadas e `settings.routing.ai_inactivity`.
- Saída: `attendance_notices`, `attendance.notice_requested`, `webchat_messages`, `fn_service_status`.
- Atividade: auditoria `conversation.inactivity_run`, eventos e mensagens da timeline do Inbox/webchat.
- Porta e configuração: rota existente `/app/settings/atendimento`, no registro de navegação. Sem configuração, checkbox desmarcado; não ativa silenciosamente.
- Próximo passo: pergunta, espera recibo, aguarda resposta e encerra com motivo explícito; falha de envio segue Central de avisos existente, sem fechar.
- Continuidade: preserva fronteira do episódio e pausa humana. Reabertura usa o núcleo existente, sem reaproveitar temporizador antigo.
- Retorno: resposta, revisão e recibo alteram/cancelam a decisão. Não há ajuste autônomo dos prazos: decisão humana pela superfície acima.
- Mapa: `docs/architecture/protocolo-atendimento.architecture.json`.
- Evidência: `tests/invariants/atendimento-inatividade.test.ts`, schema e formulário testados; instalação e reaplicação do baseline pelo `scripts/test-db.sh`.
