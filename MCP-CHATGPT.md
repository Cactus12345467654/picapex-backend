# Picapex CRM MCP — ChatGPT pieslēgums

MCP adrese: `https://picapex-backend.onrender.com/mcp`.

Pieslēgums nodrošina tikai sadaļas **Klienti sildīšanai** darbības. MCP tokens neder parastajam CRM API, un esošā `API_KEY` netiek mainīta. MCP izmanto servera iekšējo, fiksēto `/api/warming-restaurants` API; vispārīgs URL, SQL, kontaktu dzēšana vai citas CRM sadaļas nav pieejamas.

## 1. Render iestatījumi

Backend GitHub repozitorijs: `Cactus12345467654/picapex-backend`, atzars `main`.
Build: `npm ci`; start: `npm start`; ieteicamais Node: 22 vai jaunāks.

Lokāli backend mapē vienu reizi palaid `node scripts/generate-mcp-secrets.js`. Tas izveido `mcp-credentials.secret.json`, kura saturs netiek izdrukāts un kuru Git ignorē. Esošu failu ģenerators nepārraksta.

Render → esošais backend pakalpojums → **Environment → Add Environment Variable**. Pievieno visus trīs kopā:

| Nosaukums | Vērtība |
| --- | --- |
| `MCP_PUBLIC_URL` | `https://picapex-backend.onrender.com` (bez `/mcp`) |
| `MCP_CLIENT_SECRET` | Tā paša nosaukuma vērtība lokālajā `mcp-credentials.secret.json` |
| `MCP_LOGIN_SECRET_HASH` | Tā paša nosaukuma pilnā `salt:hash` vērtība lokālajā failā |

Saglabā ar **Save, rebuild, and deploy** (vai saglabā un izmanto **Manual Deploy → Deploy latest commit**). `API_KEY` un `DATABASE_URL` atstāj esošās. `mcp_login_password` un `chatgpt_client_id` nav Render mainīgie. Nav vajadzīga OpenAI API atslēga.

Pirms šo mainīgo pievienošanas MCP ir izslēgts, bet CRM turpina darboties. Daļēja vai nederīga MCP konfigurācija aptur servera startu, lai nepieļautu neaizsargātu piekļuvi. Visus trīs pievieno vienā saglabāšanas reizē. Ja jāatslēdz MCP, noņem visus trīs kopā un pārstartē.

Startējot automātiski tiek piemērotas papildinošās migrācijas: OAuth stāvokļa tabula un unikāls izvēles `request_id` piezīmēm. Restorānu vai citu CRM datu dzēšana nenotiek.

## 2. Pārbaude pēc publicēšanas

- Backend sākumadrese atgriež `release: "mcp-v1"` un `mcp: "enabled"`.
- `https://picapex-backend.onrender.com/.well-known/oauth-protected-resource/mcp` atgriež JSON ar `resource`, kas sakrīt ar MCP adresi.
- `/mcp` bez OAuth atgriež **401** — tas ir pareizi; MCP nav parasta tīmekļa lapa.
- Lokāli ar saglabāto atslēgu failu palaid `node scripts/check-mcp.js`. Tas pārbauda OAuth, SDK savienojumu, rīku sarakstu, Rīgas datumu un aizliegumu piekļūt pārējo kontaktu API. Pārbaude izveido un atsauc tikai OAuth sesiju; tā nerada un nemaina CRM ierakstus.

## 3. Pievienošana ChatGPT

1. ChatGPT tīmekļa versijā atver **Settings → Security and login → Developer mode** un ieslēdz to. Pieejamība ir atkarīga no konta un darbvietas politikas.
2. Atver [ChatGPT Plugins](https://chatgpt.com/plugins), nospied **+**, pievieno savu MCP pieslēgumu.
3. Nosaukums: **Picapex CRM — Klienti sildīšanai**. Apraksts: **Restorānu meklēšana, kontakti, vizītes, piezīmes un nākamās darbības.**
4. **Connection / MCP server URL:** `https://picapex-backend.onrender.com/mcp`.
5. Autentifikācija: **OAuth**, ar iepriekš reģistrētu klientu. **Client ID:** `picapex-chatgpt`. **Client Secret:** lokālā faila `MCP_CLIENT_SECRET`. Neizmanto CRM `API_KEY` un neatstāj autentifikāciju kā “None”.
6. Izveido/savieno pieslēgumu. Picapex autorizācijas lapā laukā **MCP pieslēguma parole** ievadi lokālā faila `mcp_login_password`, tad **Atļaut piekļuvi**. Parole nav jāraksta sarunā.
7. Pārbaudi, ka pieslēgums atrod zemāk minētos 8 rīkus. Sāc jaunu sarunu un pievieno pieslēgumu no rīku izvēlnes.
8. Pirmajai pārbaudei lūdz tikai meklēt reāli esošu restorānu vai parādīt Rīgas datumu. Rakstīšanai izmanto tikai reāli notikušas vizītes informāciju.

OAuth callback atbalsts: `https://chatgpt.com/connector_platform_oauth_redirect` un `https://chatgpt.com/connector/oauth/{callback_id}`. Citi domēni netiek atļauti. Klients ir fiksēts; DCR/CIMD reģistrācija nav vajadzīga. Ja interfeiss prasa scope, ievadi `warming:read warming:write`.

Aktuālie OpenAI soļi: [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt). Autentifikācijas prasības: [Authentication](https://developers.openai.com/plugins/build/auth).

## Lietošana un rīki

Vari rakstīt vai diktēt tekstu ChatGPT ziņas laukā. Pēc diktēšanas pārskati transkriptu, īpaši nosaukumus un adreses, un nosūti ziņu. Atsevišķā nepārtrauktās balss sarunas režīma spraudņu atbalsts šeit nav pārbaudīts; MCP apstrādā ChatGPT nosūtītus strukturētus rīku izsaukumus, nevis audio failus.

Reālas vizītes apraksta veidne: “Šodien biju [restorāna nosaukums], [adrese, pilsēta]. Runāju ar [persona/loma, ja zināma]. [Kas notika un intereses statuss, ja pateikts]. Nākamā darbība — [darbība] [datums]. Saglabā sadaļā Klienti sildīšanai.”

| Rīks | Darbība |
| --- | --- |
| `get_riga_date` | Rīgas datums un relatīva datuma pārvēršana |
| `search_restaurants` | Meklēšana pēc nosaukuma/adreses/pilsētas |
| `select_restaurant` | Lietotāja precizētas neskaidras atbilstības izvēle |
| `create_restaurant` | Restorāna pievienošana ar esošo dublikātu aizsardzību |
| `update_restaurant` | Kontakti, interese, pēdējā saziņa, nākamā darbība/datums |
| `record_interaction` | Vizīte/saziņa ar vēsturi un atkārtojumu aizsardzību |
| `add_note` | Jauna piezīme ar atkārtojumu aizsardzību |
| `get_restaurant_history` | Kartīte, vizītes, saziņa un piezīmes |

Neskaidra meklēšana atgriež kandidātus un `requires_clarification`, bez rakstīšanas izvēles tokena. Pēc lietotāja precizējuma izmanto `select_restaurant`. Precīzai nosaukuma un adreses atbilstībai vai jaunizveidotam ierakstam izdod parakstītu 30 minūšu izvēles tokenu. Pirms lietošanas serveris vēlreiz pārbauda ieraksta identitāti. Šī aizsardzība nevar pati pierādīt sarunas saturu; modelim ir skaidri aizliegts izdomāt lietotāja precizējumu.

Nezināmus laukus izlaiž, esošās vērtības saglabā. Tukšs teksts vai `null` atjauninājumā nozīmē apzinātu dzēšanu un lietojams tikai pēc lietotāja lūguma. Datumi: `YYYY-MM-DD`, vai `šodien`, `vakar`, `rīt`, `parīt` (arī today/yesterday/tomorrow), vienmēr Europe/Riga. Citiem relatīviem datumiem vispirms noskaidro Rīgas datumu un, ja vajadzīgs, precizē ar lietotāju. Atkārtotiem notikuma pieprasījumiem saglabā nemainīgu `request_id` un sākotnēji atrisinātu absolūto datumu.

Vecāka datuma vizīte papildina vēsturi, bet nepārraksta jaunākās saziņas kartītes stāvokli. Apzinātai pēdējās saziņas datuma maiņai izmanto `update_restaurant`. Esoša restorāna atrašana izveides laikā to nepārraksta; kontaktu papildinājumi jāveic atsevišķi.

## Piekļuves uzturēšana un testi

Šī ir viena CRM īpašnieka integrācija ar atsevišķu paroli, nevis vairāku lietotāju lomu sistēma. OAuth izmanto S256 PKCE, divu minūšu vienreizējus kodus, stundas access tokenus un rotējošus 30 dienu refresh tokenus. Tokens DB tiek glabāts tikai SHA-256 hash veidā. Veca refresh tokena atkārtota lietošana atsauc tā piekļuves saimi. Autorizācijas dati saglabājas PostgreSQL un pārdzīvo restartu.

Nomainot `MCP_LOGIN_SECRET_HASH` vai `MCP_CLIENT_SECRET`, iepriekšējie MCP tokeni kļūst nederīgi; CRM `API_KEY` paliek spēkā. Ja maini klienta secret, atjaunini to arī ChatGPT. `/oauth/revoke` atsauc konkrētu OAuth piekļuves saimi. Paroles, tokenus un ģenerēto JSON failu nepublicē GitHub.

`npm test` izmanto tikai izolētu PGlite PostgreSQL datubāzi atmiņā un localhost serveri. Aptver OAuth pozitīvos/negatīvos scenārijus, PKCE un kodu atkārtošanu, datumu robežas/DST, visas MCP darbības, neskaidras izvēles, dublikātus, vēsturi, parastā CRM atslēgas saglabāšanu un piekļuves izolāciju. Dzīvajā CRM testu ieraksti netiek veidoti.

## Autorizācijas formas diagnostika

Pārlūka formas regresijas pārbaude: palaid `node test/browser-oauth.cjs`, atver `http://127.0.0.1:3197/start`, ievadi tikai šī izolētā testa paroli `local-browser-test` un iesniedz formu. Veiksmīgs rezultāts: `Authorization accepted. PKCE token exchange: PASS`. Šis tests izmanto datubāzi atmiņā, ģenerē savas pagaidu atslēgas un pārtver callback lokāli; tas neizmanto dzīvo CRM vai tā paroles. Pēc pārbaudes apturi procesu ar Ctrl+C.

Autorizācijas HTML atbildei nepieciešams `Referrer-Policy: strict-origin`. Iepriekšējais `no-referrer` lika pārlūka HTML formai nosūtīt `Origin: null`; izcelsmes pārbaude noraidīja pieprasījumu pirms formas tokena un paroles pārbaudes. `strict-origin` saglabā pareizo Origin, bet Referer neatklāj OAuth ceļu vai vaicājuma parametrus. Svešs Origin un `Origin: null` joprojām tiek noraidīti.

403 atbildes `reason` un servera `mcp_oauth_denied` žurnāla ieraksts satur tikai fiksētu iemesla kodu, nekad paroli, tokenu vai pieprasījuma datus:

- `origin_mismatch`: formas pieprasījuma izcelsme neatbilst backend adresei.
- `authorization_form_invalid_or_expired`: formas tokens nav derīgs, ir izmantots, beidzies vai izdots ar iepriekšējo konfigurāciju; sāc jaunu pieslēgšanu no ChatGPT.
- `invalid_password_input`: paroles lauka formāts nav pieņemams.
- `password_mismatch`: paroles pārbaude pret konfigurēto hash neizdevās.

Šim labojumam Render vides mainīgie un paroles nav jāmaina; jāpublicē jaunā backend versija un jāatver jauna autorizācijas forma.
