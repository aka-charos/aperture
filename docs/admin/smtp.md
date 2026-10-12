# Outgoing Email (SMTP)

The mail server Aperture sends email through. **Nothing sends email yet.** This page sets up the connection and proves it works, and the notification features added later will use it.

## Where It Lives

Admin console → **Integrations** → **Outgoing email** (`/admin/integrations/smtp`). The chip reads **Sending on** or **Sending off**.

## Configuration

| Field | Notes |
|-------|-------|
| **Send email** | Master switch, off by default. It cannot be switched on while the server, the From address or a login's password is missing. Testing works with it off. |
| **Mail server** | Host name or IP only: no `smtp://`, no `:port` |
| **Port** | Changing **Security** moves the port to that mode's usual one (587 / 465 / 25), unless you typed a different port yourself |
| **Security** | **STARTTLS**: connects, then must switch to encryption before logging in. If the server cannot switch, the attempt stops and the password is never sent. **SSL/TLS**: encrypted from the first byte, usually port 465. **None**: no encryption, only for a relay on the same machine or a trusted network. |
| **Accept a self-signed certificate** | Keeps encryption but skips checking the server's identity. Only for a mail server you run yourself. |
| **Username / Password** | Leave the username blank for a relay that takes mail without a login. With a username set, the login is always attempted, even if the server does not advertise it, so a wrong password fails the test instead of slipping through. The password is masked once saved. It is only ever sent to the server it was saved for, over a connection at least as secure as the one it was saved with: change the server, switch to **None**, or accept a self-signed certificate, and you must enter it again. |
| **From address** | Most providers only accept an address that belongs to the account you log in with |
| **From name** | Blank uses the instance name (Settings → System), so a rename follows |
| **Public address** | The address people open the app at, used for links in emails. Leave blank to use `APP_BASE_URL`. A local address like `localhost` is refused. While neither is set, or `APP_BASE_URL` is a local address, emails carry no links rather than links that go nowhere. |
| **EHLO name** | The name Aperture introduces itself with. Leave it blank unless the mail server refuses the default: inside Docker that default is `[127.0.0.1]`, which strict servers reject or score as spam. |

## Testing

- **Test connection** connects, sets up encryption as the mode requires, and logs in. It sends nothing.
- **Send test email** connects, logs in and sends a short message, to your own address by default.
- **Preview** shows that test email as it would be sent, in any language, without connecting or sending anything.

All three use the settings on the card **whether or not they are saved**; the two that connect give up after 45 seconds. A failure names its cause and shows the server's own reply beneath it. Causes include a refused login, a server that only takes a login over encryption, a security mode that does not match the port, a certificate that could not be verified, a refused From address, a refusal to relay and a blocked port.

Common fixes:

| Provider | Settings |
|----------|----------|
| Gmail / Google Workspace | `smtp.gmail.com`, STARTTLS 587, your address as username, an **app password** (not your normal one) |
| Outlook / Microsoft 365 | `smtp.office365.com`, STARTTLS 587 (the account must allow SMTP AUTH) |
| A relay in the same Docker network | its container name, None or STARTTLS on 25, no login |

Many hosting providers block outgoing port 25. A test that times out on 25 is usually that.

## What Emails Look Like

Every email has an HTML version and a plain-text version with the same content, in the recipient's own interface language. Recipients see the instance name at the top in the theme's primary colour, and posters travel inside the message, so no "load images" prompt appears and nobody outside learns it was opened.

## Who Receives Email

Not decided here. Each user's address and opt-in live in their own settings (the **Email & Notifications** card on their settings' Preferences tab), shown only to users an admin has granted it on the Users page. The addresses come from the media server sync, from [LLDAP](lldap.md), or from the user. Each must be one plain address: a list, a display-name form or a typo with spaces is refused when typed in and skipped when imported.

## Account Drift

The **Account drift** card under the connection compares three lists, read live each time the page opens or **Check again** is pressed: the accounts on the media server, the accounts in LLDAP (when [LLDAP](lldap.md) is set up), and Aperture's own. Aperture takes its accounts from the media server, matched by account id, and each one's address from the LLDAP account with the same username, ignoring capitals. Removing someone from one of the three does not remove them from the others, and the Users page cannot show it, because it is drawn from the media server's own list.

Each person is one row, with a chip per place they have an account (hover a chip for last activity, groups, or the address on file). **Out of step** is what needs a decision:

| Finding | What it means |
|---|---|
| In LLDAP only | No media-server account and none in Aperture. If they were removed from the media server, remove them from LLDAP too. If the media server signs people in through LDAP, someone who has never signed in shows here as well. |
| No longer on the media server | Aperture still has the account, and usually an address it could one day email. The user sync signs it out and pauses its work; remove it from the Users page ([User management](user-management.md#accounts-no-longer-on-the-media-server)). |
| Still in LLDAP | Shown with the one above. With LDAP sign-in, they can sign in again and get a new account. |
| Left over | The media server has a newer account with the same name, and the email import gives the old one the same address. |
| No LLDAP account | On the media server with no LLDAP account of that name, so no address is imported for them. Common for a local admin account. |
| Renamed | Renamed on the media server. Aperture keeps the old name until the person next signs in, and the email import looks them up under it. |
| Unusable LLDAP address | LLDAP holds something that is not one plain address, so it is not imported. |

**Notes** are the normal course of things: an account the next user sync will import, one disabled on the media server, an LLDAP account with no address, an address waiting for the next email import, or an address the person set themselves (kept over LLDAP's). The account Aperture itself uses to read LLDAP is named as a service account rather than reported.

The card only reports; it changes nothing. If the media server cannot be read there is nothing to compare against and the card says so. If LLDAP cannot be read, the rest is still compared and nothing is said about LLDAP.

---

**Related:** [LLDAP](lldap.md) · [User management](user-management.md) · [Integrations overview](integrations-overview.md)
