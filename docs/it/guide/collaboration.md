# Conversazioni e dashboard

## Discutere un test o un risultato

Aprite **Commenti** su un test web, API o mobile salvato, oppure sul risultato di un test nel report.
I membri, inclusi i viewer, possono partecipare quando hanno accesso al test o al risultato.
Le conversazioni appartengono all'organizzazione corrente e rispettano i permessi del progetto.

Scrivete un **Nuovo commento** per iniziare una conversazione, oppure scegliete **Rispondi** su
una conversazione aperta. Le risposte restano sotto il messaggio originale: esiste un solo livello
di risposte. I messaggi sono testo semplice, fino a 5.000 caratteri.

Espandete **Menziona membri** e selezionate le persone da menzionare, fino a 20 per messaggio.
L'elenco contiene i membri della stessa organizzazione che possono leggere il test o il risultato.
I loro nomi utente compaiono accanto al messaggio. Scrivere soltanto un nome utente non seleziona
una menzione. Modificando il messaggio potete cambiare anche le menzioni selezionate.

Usate **Filtro conversazioni** per vedere tutte le conversazioni, quelle aperte, quelle risolte
o quelle **In cui sono menzionato**. Anche una menzione in una risposta include la sua conversazione
nel filtro. Le menzioni sono visibili nella discussione e nel filtro; non esistono una casella di
notifiche separata o notifiche email.

L'autore del messaggio originale e gli owner dell'organizzazione possono **Risolvere la
conversazione** o **Riaprire la conversazione**. Una conversazione risolta conserva i messaggi,
ma accetta nuove risposte solo dopo la riapertura. Gli autori possono modificare o eliminare i
propri messaggi; gli owner possono moderarli. Eliminando un messaggio originale che ha risposte
resta il segnaposto **Questo commento è stato eliminato**: testo e menzioni scompaiono, mentre le
risposte degli altri membri restano leggibili. Un messaggio originale eliminato non accetta altre
risposte. Eliminando un test salvato vengono eliminate le discussioni sui suoi risultati storici,
mentre i report restano disponibili.

## Scegliere e condividere dashboard

In **Dashboard**, selezionate la dashboard da visualizzare. Potete creare più dashboard,
rinominarle, duplicarle, eliminarle e scegliere quella predefinita personale. Un duplicato è una
copia privata che potete modificare indipendentemente. La scelta predefinita vale per il vostro
account; eliminando una dashboard si cancellano le selezioni che la utilizzavano.

| Visibilità | Chi può leggerla | Chi può modificarla o eliminarla |
|---|---|---|
| Privata | Chi l'ha creata | Chi l'ha creata |
| Condivisa con l'organizzazione | Membri della stessa organizzazione | Chi l'ha creata e proprietari dell'organizzazione |

I proprietari dell’organizzazione non possono aprire le dashboard private degli altri membri. Gli altri
membri possono duplicare una dashboard condivisa in una copia privata. La condivisione riguarda
la configurazione: ciascun lettore continua a vedere soltanto i dati di test e progetti a cui
ha accesso. Un widget configurato per un progetto non accessibile al lettore appare come non
disponibile, senza mostrare il nome del progetto o i suoi conteggi.

La disposizione personale esistente diventa una dashboard privata, conservando ordine e
visibilità dei widget. Le dashboard appartengono a chi le ha create: rimuovendo quel membro si
eliminano le sue dashboard private e condivise e si azzerano i riferimenti degli altri membri.
Per conservare una dashboard condivisa, duplicatela prima di rimuovere il creatore.
Se non avete una disposizione salvata, la dashboard privata iniziale
contiene i cinque widget originali: indicatori, stato delle esecuzioni, andamento, prossime
pianificazioni e report recenti.

## Modificare i widget

Scegliete **Personalizza dashboard** su una dashboard che potete gestire. Aggiungete o rimuovete
widget, spostateli su o giù, mostrateli o nascondeteli e impostate titolo e larghezza a metà o
intera. Potete aggiungere più volte lo stesso tipo di widget, per confrontare progetti o periodi.
Una dashboard contiene al massimo 20 widget, inclusi quelli nascosti.

Le opzioni disponibili dipendono dal widget:

- **ID progetto (facoltativo)** limita i dati a un progetto accessibile tramite il suo ID numerico; lasciando il campo vuoto vengono usati i dati accessibili.
- **Periodo** accetta da 1 a 365 giorni.
- **Limite risultati** accetta da 1 a 50 elementi per report recenti o pianificazioni.
- **Ambiente** filtra le prossime pianificazioni.

Salvate la disposizione per conservarla tra le sessioni. Se un'altra persona ha salvato la
dashboard dopo l'apertura dell'editor, il salvataggio segnala un conflitto (HTTP 409) e conserva
la vostra bozza. Ricaricate la dashboard aggiornata e applicate di nuovo le modifiche: la bozza
precedente non può sovrascrivere il salvataggio dell'altra persona.
