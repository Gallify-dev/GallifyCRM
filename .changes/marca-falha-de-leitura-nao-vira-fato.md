---
impacto: nada_mudou
secao: corrigido
titulo: A marca enviada deixa de sumir da barra lateral quando o banco não responde
---
Quem sobe o logo da instalação em Configurações › Marca recebe o aviso “Logo atualizado.” e, no render seguinte, o desenho da marca. Se a consulta ao banco falhasse exatamente nesse instante — uma resposta perdida, um pico de carga no banco —, o sistema tratava o silêncio como resposta e guardava “não há marca gravada” por 30 segundos: a barra lateral voltava a desenhar a marca do produto, sem logo, com o arquivo novo já gravado e sem nada na tela dizendo que algo tinha falhado. Agora a leitura que falha vale só para aquela tela: a tela seguinte pergunta ao banco de novo e mostra a marca enviada. Quando o banco responde, nada muda — a marca continua sendo lida uma vez a cada 30 segundos.
