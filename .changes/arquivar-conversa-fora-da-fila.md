---
impacto: capacidade_nova
secao: adicionado
titulo: A conversa ganha "Arquivar" — sai da fila viva, fica guardada numa aba própria e volta sozinha quando o cliente escreve
---

Quem atende passa o dia na Fila, e nem tudo que acaba ali merece continuar à vista: conversa que o cliente abandonou, número que era trote, atendimento que já terminou e ninguém fechou. Até agora não havia nada a fazer com isso — a conversa ficava na lista para sempre, empurrando para baixo o que ainda é trabalho. Excluir de vez continua fora, porque o histórico é do cliente e não se apaga.

Agora existe **Arquivar**. Tudo que já é do passado ruma para uma pasta própria: a conversa sai da Fila e das listas de conversas em andamento, aparece na aba **Arquivadas** (ao lado de "Fechadas", com o próprio número) e o histórico continua inteiro para quem for consultar. Arquivar **encerra o atendimento**, como um fechamento — a diferença é onde a conversa fica guardada e o rastro que fica na auditoria. Se o cliente escrever de novo, a conversa volta sozinha para a caixa de entrada — o banco já fazia essa volta, e agora a tela conta isso em vez de esconder.

Quem pode arquivar é quem já podia encerrar: atendente para cima. O que passa a ficar registrado é o motivo da mudança: arquivar deixa o evento próprio `conversation.archived` na auditoria, em vez de se confundir com "devolvida" ou com o fechamento do atendimento. Fechar continua sendo fechar, e o número da aba "Fechadas" passa a contar só as fechadas — antes ele somava as arquivadas e mostrava mais do que a lista.
