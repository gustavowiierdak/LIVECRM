import { describe, expect, it } from 'vitest';

import { despedidaSimples } from './encerramento-apos-fatura';

describe('despedida após entrega de fatura', () => {
  it.each([
    'obrigado', 'Obrigada!', 'muito obrigado 🙏', 'valeu, boa noite',
    'obg', 'agradeço', 'era só isso, obrigado',
  ])('reconhece uma despedida simples: %s', (texto) => {
    expect(despedidaSimples(texto)).toBe(true);
  });

  it.each([
    'obrigado, mas o PIX não funcionou', 'obrigado, pode mandar outra fatura?',
    'valeu, preciso também do contrato', 'oi', 'paguei, obrigado',
    'obrigado? não entendi', 'me manda o boleto',
  ])('não confunde pedido ou problema com despedida: %s', (texto) => {
    expect(despedidaSimples(texto)).toBe(false);
  });
});
