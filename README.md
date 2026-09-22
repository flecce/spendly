# Spendly

Web app mobile-first per segnare le spese in pochi secondi. Non c'è un backend: i dati vivono in un file dell'utente, che fa da database.

- **Google** → foglio Google Sheets `Spendly` nel Drive dell'utente
- **Microsoft** → file Excel `Spendly.xlsx` nella radice di OneDrive
- **Senza account** → dati solo nel browser (utile per provare)

Lingue: italiano, inglese, spagnolo, francese, tedesco (rilevata dal browser, modificabile nelle impostazioni).

## Funzionalità

- **Aggiungi**: nota, totale (con valuta) e categoria. La categoria viene **riconosciuta dalla nota**: parole chiave multilingua (modificabili) + apprendimento dalle spese già inserite (una nota già usata ritrova la sua categoria). Data con scorciatoie *Oggi / Ieri* e calendario.
- **Valute**: ogni spesa ha la sua valuta (EUR, USD, GBP, CHF, JPY e le altre ~30 con cambio BCE). I totali sono convertiti nella *valuta principale* al cambio BCE del giorno della spesa ([frankfurter.dev](https://frankfurter.dev), gratuito, senza chiave). I cambi sono salvati in cache per l'uso offline.
- **Budget mensile**: un importo valido per ogni mese. Nella dashboard e in cima alla pagina di inserimento c'è un indicatore del mese corrente: speso/budget, quanto resta e quanto puoi spendere al giorno fino a fine mese. Oltre a *sopra/sotto* confronta la spesa con il ritmo del mese (al giorno 10 di 30 dovresti essere a circa un terzo): *In linea* (blu), *Attenzione* (giallo, con la proiezione a fine mese) se spendi più in fretta del previsto o sei oltre il 90%, *Superato* (rosso). Dopo ogni spesa il messaggio di conferma dice quanto resta o avvisa se hai sforato. Il budget è salvato nel file, quindi è lo stesso su tutti i dispositivi.
- **Dashboard**: periodo (default ultimi 30 giorni; 7 giorni, mese, mese scorso, anno, personalizzato), totale, media giornaliera, andamento (giorni/settimane/mesi a seconda del periodo), ripartizione per categoria (tocca una categoria per filtrare l'elenco), elenco spese per giorno.
- **Categorie**: crea, rinomina (aggiorna anche le spese esistenti), icona, colore, parole chiave, elimina.
- **Veloce**: ~40 KB gzip, nessuna dipendenza runtime. Le modifiche sono applicate subito e sincronizzate in background con una coda persistente: funziona anche offline e riprova da sola.

## Formato del file

| Foglio | Colonne |
|---|---|
| `Expenses` | Date · Amount · Currency · Category · Note · ID |
| `Categories` | Name · Icon · Color · Keywords |
| `Settings` | Key · Value (`monthlyBudget`, `budgetCurrency`) |

Il file si può modificare anche a mano: le righe senza ID vengono riconosciute; una valuta vuota vale come valuta principale.

## Sviluppo

```bash
npm install
cp .env.example .env    # poi inserisci i client ID (vedi sotto)
npm run dev             # http://localhost:5173
npm test
npm run build           # sito statico in dist/
```

`dist/` si pubblica su qualsiasi hosting statico (GitHub Pages, Netlify, Vercel, Cloudflare Pages…). Il build usa percorsi relativi, quindi funziona anche in una sottocartella.

### GitHub Pages

Il workflow `.github/workflows/deploy.yml` esegue test e build e pubblica il sito a ogni push su `main`.

1. Su GitHub: *Settings → Pages → Source*: **GitHub Actions**.
2. *Settings → Secrets and variables → Actions → Variables*: crea `VITE_GOOGLE_CLIENT_ID` e/o `VITE_MS_CLIENT_ID` (sono ID pubblici, bastano le variabili).
3. Fai push: il sito sarà su `https://<utente>.github.io/<repository>/`.
4. Registra quell'indirizzo, con la `/` finale, tra i redirect URI di Google e di Azure; su Google aggiungi anche l'origine `https://<utente>.github.io`.

## Configurare l'accesso con Google

1. [Google Cloud Console](https://console.cloud.google.com/) → crea un progetto.
2. *API e servizi → Libreria*: abilita **Google Sheets API** e **Google Drive API**.
3. *Schermata consenso OAuth*: tipo *Esterno*, aggiungi lo scope `.../auth/drive.file` (non sensibile: l'app vede solo i file che crea lei). In modalità test aggiungi gli utenti di prova, oppure pubblica l'app.
4. *Credenziali → Crea credenziali → ID client OAuth* → tipo **Applicazione web**:
   - *Origini JavaScript autorizzate*: `http://localhost:5173` e l'URL di produzione (es. `https://tuodominio.it`)
   - *URI di reindirizzamento autorizzati*: `http://localhost:5173/` e l'URL esatto dove è pubblicata l'app (es. `https://tuodominio.it/spendly/`)
5. Copia il Client ID in `.env` → `VITE_GOOGLE_CLIENT_ID=...`

## Configurare l'accesso con Microsoft

1. [Portale Azure](https://portal.azure.com/) → *Microsoft Entra ID → Registrazioni app → Nuova registrazione*.
2. *Tipi di account supportati*: **account in qualsiasi directory organizzativa e account Microsoft personali**.
3. *URI di reindirizzamento*: piattaforma **Applicazione a pagina singola (SPA)** → `http://localhost:5173/` (e poi l'URL di produzione).
4. *Autorizzazioni API* → Microsoft Graph, delegate: `User.Read`, `Files.ReadWrite`, `offline_access`, `openid`, `profile`, `email`.
5. Nessun segreto client: copia l'*ID applicazione (client)* in `.env` → `VITE_MS_CLIENT_ID=...`
   (`VITE_MS_TENANT` è opzionale: `common` di default).

## Note tecniche

- Accesso con redirect a pagina intera (niente popup): funziona anche da app installata sulla schermata home.
  - Google: flusso OAuth per app client-side; il token dura 1 ora, poi l'app lo rinnova con un redirect silenzioso.
  - Microsoft: codice di autorizzazione + PKCE, con refresh token.
- Il token resta nel `localStorage` del browser e va solo a Google/Microsoft; l'app non ha server propri.
- Codice: `src/drivers/` (Google Sheets, Excel via Microsoft Graph, locale), `src/store.ts` (stato + coda di sincronizzazione), `src/categorize.ts` (riconoscimento categoria), `src/rates.ts` (cambi), `src/budget.ts` (budget mensile), `src/pages/` (schermate).
