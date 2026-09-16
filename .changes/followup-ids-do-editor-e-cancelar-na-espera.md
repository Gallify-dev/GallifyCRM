---
impacto: nada_mudou
secao: corrigido
titulo: O construtor de follow-up para de reaproveitar identificadores, e "cancelar se o lead responder" passa a valer na espera
---
Duas coisas que estavam quebradas no acompanhamento automático. A primeira: ao abrir um fluxo já salvo e acrescentar um passo ou uma ligação, o construtor recomeçava a contagem de identificadores do zero — o passo novo nascia com o mesmo identificador de um que já existia, e a ligação que você acabou de desenhar aparecia por cima de outra, ou o salvamento era recusado. Agora a contagem continua de onde o fluxo parou. A segunda: a chave "cancelar se o lead responder" só valia enquanto o fluxo esperava uma resposta; numa espera por tempo — "aguarde 2 dias" —, a resposta do cliente não cancelava nada e a próxima mensagem saía assim mesmo, como se ele não tivesse respondido. Agora cancela nos dois casos.

Um aviso para quem já editou fluxos antes desta versão: um rascunho que ficou com identificadores repetidos **não se conserta sozinho**. Abra o fluxo, apague o passo ou a ligação duplicada pela tela e salve de novo — daí em diante o problema não volta.
