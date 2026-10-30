# Account Settings

The **Account** tab holds your email address and the services linked to your account. It only appears when it has something on it: email notifications granted to you, Trakt set up on the server, or the older AI Picks libraries still being written.

## Accessing

Click your **avatar** in the top bar and pick **Account**.

---

## Email & Notifications

Your email address. This card appears only when your **admin allows email notifications** for your account. What Aperture emails you about is chosen on the **Notifications** card below. The address must be one plain email address.

The address starts out synced from your media server account. Setting your own **keeps it** from being overwritten from Emby or Jellyfin later (the text under the field tells you which it is). Changes save when you leave the field.

## Notifications

Choose what Aperture tells you about, one switch per event:

- **Watch This**: someone you're connected with sent you a title.
- **Requests**: a request you made was approved, declined or became available. A request approved the moment you made it doesn't notify.
- **Issue replies**: someone replied to a problem you reported, or marked it resolved.
- **New recommendations**: your recommendations were refreshed.

**Email** is off for every event until you switch it on. Aperture checks every 15 minutes and sends one email listing everything new since the last one, never one email per event. Nothing from before you switched an event on is sent. The switches are greyed out until your account has an email address, with a note saying so.

When you have a phone set up to receive notifications, a second column appears beside Email for it, along with the list of your phones. **Remove** forgets a phone you no longer use.

## Trakt Integration

Connect, sync or disconnect your Trakt account. The card appears only when your admin has set up Trakt on the server. See [Trakt Integration](../trakt-integration.md) for the whole flow.

## AI Library Names

The names of your two AI Picks libraries in Emby or Jellyfin ("*YourName*'s AI Picks - Movies" and "- TV Series" by default). These libraries are a legacy feature, off on new installs, and the card appears only while your server still writes them. Leave a field empty to use the server's naming template. New names are used at the next library update, and a name another library already uses is refused. Keep names short; they show in TV menus. See [Virtual Libraries](../virtual-libraries.md).

---

**Related:** [Trakt Integration](../trakt-integration.md) · [Display](display.md)
