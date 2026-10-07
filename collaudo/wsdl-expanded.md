# Import WSDL con strutture XSD più complete

Protocollo 38: API-61…API-64. Nuovi casi **Da eseguire**; nessun esito automatico assegnato ai cicli manuali. I cicli storici restano congelati.

Aggiornare API e client; usare un editor con accesso ai test API. Caricare i tre file di `collaudo/fixtures/wsdl` e scegliere `service.wsdl` come documento principale, con percorsi logici `service.wsdl`, `request.xsd`, `common.xsd`. Le fixture sono sintetiche e l’endpoint `orders.example` non è un servizio disponibile: non inviare richieste senza configurare un endpoint di prova e completare valori, attributi e wildcard.

- API-61: mostrare l’anteprima e importare. Verificare OrderId/AddressId nel namespace urn:common, Sku/Quantity nel namespace urn:request e due Line. ServiceCode/AddressText non devono comparire. Ricaricare e confrontare il test salvato.
- API-62: controllare avvisi per choice, ripetizioni, wildcard e attributi. Il commento any indica dove inserire estensioni; modificare minOccurs della wildcard a 1 e verificare l’avviso. Un envelope ben formato non dimostra conformità XSD.
- API-63: sostituire il riferimento Identity con Missing; poi rendere Address ricorsivo riferendolo a Identity. L’import deve fallire senza salvare nuovi test. Provare minOccurs 5001/maxOccurs unbounded e un minOccurs negativo.
- API-64: cambiare il binding in style rpc o use encoded: entrambi devono fallire. Con ripristino document/literal, import valido. Le restriction complesse restano rifiutate.

Test automatici: `server/wsdl-expanded.test.ts`, `server/wsdl-import.test.ts`, `server/api-import.test.ts` e il percorso UI in `e2e/installation.spec.ts`. L’accettazione sui WSDL/XSD reali dei clienti resta da eseguire quando saranno disponibili; RPC/encoded richiede una richiesta cliente dedicata.
