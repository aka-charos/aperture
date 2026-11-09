# Newsletters

Write an email in a rich-text editor, drop library titles into it, and send it to groups of people. Each person gets it in their own app language, and only people who switched newsletters on themselves receive anything.

## Where It Lives

Admin console → **Communication** → **Newsletters** (`/admin/communication/newsletters`) and **Send groups** (`/admin/communication/groups`).

Newsletters go out through [Outgoing email](smtp.md), which must be switched on, fully set up, and have a **Public address**: every newsletter carries an unsubscribe link, and without a public address there is nowhere for it to point. Until all three are in place the page says what is missing and the **Send** button stays disabled.

## Who Receives a Newsletter

Three things must all be true for a person:

1. **They switched newsletters on.** Settings → Account → **Newsletters**, off for everyone until they turn it on. An admin cannot switch it on for someone, and adding a person to a group does not subscribe them.
2. **Their account has a usable email address.**
3. **They still have access** to the app, and their media-server account is not disabled.

Every newsletter carries an **Unsubscribe** link (and the one-click unsubscribe header mail clients show as their own button). It switches that person's newsletters off; it changes nothing else.

## Send Groups

A group chooses people in one of two ways:

| Mode | Members |
|------|---------|
| **Choose people by rules** | Everyone whose **app language** is one of those picked (none picked means any language), filtered to **Everyone**, **Viewers only** or **Admins only** |
| **Hand-picked only** | Only the people you add |

In both modes, **Members** lets you set anyone to **Add** (in the group whatever the rules say) or **Leave out** (never in it). Leaving someone out wins over everything. The members list shows every account, whether it is in the group and why, and whether it would actually receive a newsletter, so a group of twelve where five receive it explains the other seven.

A typical setup is one group per language, for example *English readers* (app language English) and *Greek readers* (app language Greek), each sent its own newsletter written in that language.

## Writing a Newsletter

- **Subject** is also the heading at the top of the email. **Preview text** is the line inbox lists show beside it.
- The editor offers headings, bold, italic, underline, strikethrough, lists, quotes, dividers and links (web addresses only).
- **Insert movie or show** searches the library and adds a title card. Choose what the card shows: poster, year, runtime, genres, rating, director (or creator), cast, network, languages, countries, plot, full synopsis, film analysis and a link to the title's page. Change it later with the card's settings button. The full synopsis often gives the ending away.
- With **Film analysis** ticked, choose **All of it** or **Only these parts**: Context, Form and style, Making, Critical reception, and Narrative structure for a series. Each chosen part appears under its own heading. An older analysis that is not divided into parts shows nothing for a card limited to parts, until the analysis is rewritten.
- **Save draft** stores it. Drafts and failed sends can be edited; a sent newsletter cannot, but **Duplicate as new draft** reuses it.

A title card stores only which title and which facts. The facts themselves are read when the email is built, so a card always shows the title as it is when the newsletter is sent.

## Writing Assistant

The **Writing assistant** tab beside **Preview** opens a chat that helps with the newsletter. It uses the model set for the **Chat** role in the AI settings, and is there only while the newsletter can still be edited.

Ask it for titles to feature, a whole issue, an intro for what you already have, or subject lines. It searches the library the way the main assistant does, and it can also see:

- **Recently added**: films and shows that arrived lately, and shows that got new episodes ("added" means first seen by the app).
- **Most played here** and **hidden gems**: what the household has been playing, and well-rated titles almost nobody has played. These are counts; it never names who watched what.
- **Who can open these**: how many of this newsletter's recipients can open each title, from the send groups you chose. A reader whose libraries lack a title gets the email without that card.
- **Earlier newsletters**, so it does not feature the same titles again, and **the newsletter as it stands**, unsaved edits included.

Titles it finds appear as a list with an **Add** button that inserts a title card with the default fields. Text it writes appears as a proposal with **Insert at cursor** and **Replace newsletter** (Undo brings the old text back), and a suggested subject or preview line has its own **Use** button. Nothing reaches the newsletter until you press one of them, and nothing is sent until you send it.

It writes only from what the library holds about a title, avoids spoilers, and writes in your AI language unless you ask for another. The conversation is not saved: it ends when you leave the editor, and **New conversation** starts over.

## What Each Reader Gets

- **Labels and the footer** are in the reader's app language.
- **Plots and analyses** are the [synopsis translations](synopsis-translation.md) into the reader's language where one exists, otherwise the original text. Genres use TMDb's names for that language.
- **Your own text is sent as written.** Write one newsletter per language group if your readers do not share a language.
- **A title from a library the reader cannot open is left out of their copy**, the same rule as everywhere else in the app.
- Posters are carried inside the email rather than linked, so they show even where a mail client blocks remote images. If a newsletter has more posters than fit in one message, the later cards are sent without theirs.

The **Preview** beside the editor shows the email as a reader in the chosen language would get it, with every title shown. **Send me a test** sends that version to your own account's address.

## Sending

**Send** asks for confirmation and then sends in the background; the page follows its progress. Each person is sent the newsletter once. If some messages fail (a refused address, a mail server outage), the newsletter is marked **Not fully sent**, the list shows who failed and why, and **Send to the rest** reaches only those not yet sent to. A send interrupted by a restart is marked the same way.

Sending more than a handful of messages through a personal mail account can hit that provider's daily limits; a transactional mail service suits larger households better.
