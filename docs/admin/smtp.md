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
| **EHLO name** | The name Aperture introduces itself with. Leave it blank unless the mail server refuses the default: inside Docker that default is `[127.0.0.1]`, which strict servers reject or score as spam. |

## Testing

- **Test connection** connects, sets up encryption as the mode requires, and logs in. It sends nothing.
- **Send test email** connects, logs in and sends a short message, to your own address by default.

Both use the settings on the card **whether or not they are saved**, and give up after 45 seconds. A failure names its cause and shows the server's own reply beneath it. Causes include a refused login, a server that only takes a login over encryption, a security mode that does not match the port, a certificate that could not be verified, a refused From address, a refusal to relay and a blocked port.

Common fixes:

| Provider | Settings |
|----------|----------|
| Gmail / Google Workspace | `smtp.gmail.com`, STARTTLS 587, your address as username, an **app password** (not your normal one) |
| Outlook / Microsoft 365 | `smtp.office365.com`, STARTTLS 587 (the account must allow SMTP AUTH) |
| A relay in the same Docker network | its container name, None or STARTTLS on 25, no login |

Many hosting providers block outgoing port 25. A test that times out on 25 is usually that.

## Who Receives Email

Not decided here. Each user's address and opt-in live in their own settings (the **Email & Notifications** card on their settings' Preferences tab), shown only to users an admin has granted it on the Users page. The addresses come from the media server sync, from [LLDAP](lldap.md), or from the user. Each must be one plain address: a list, a display-name form or a typo with spaces is refused when typed in and skipped when imported.

---

**Related:** [LLDAP](lldap.md) · [User management](user-management.md) · [Integrations overview](integrations-overview.md)
