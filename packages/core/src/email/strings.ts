/**
 * The words in emails, per language. Pure.
 *
 * An email is written in its RECIPIENT's interface language, which the server
 * resolves (`resolveEffectiveUiLanguage`), not in whatever the person sending
 * it happens to read. These strings live in core because the web bundle's
 * locale files are bundled into the client and cannot be read by a job.
 *
 * English is the source and is complete; every other language may leave a key
 * out and gets the English for it, key by key, so adding a string never
 * requires touching thirteen files and never produces an empty email. Values
 * are PLAIN TEXT — `renderEmail` escapes them, so a translation can never
 * carry markup into a message. `{{name}}` is filled in by `emailText`.
 *
 * A string must never name a button or a page of the web UI: the email is in
 * the recipient's language, and the UI string it would quote may still be the
 * untranslated English placeholder in that locale.
 */
import { isRtlLocale, normalizeAppLocale, type AppLocaleCode } from '../lib/locales.js'

const EN = {
  'footer.automated': 'This email was sent automatically by {{appName}}.',
  'action.openApp': 'Open {{appName}}',
  'test.subject': '{{appName}}: test email',
  'test.preheader': 'Outgoing email is working.',
  'test.heading': 'Outgoing email works',
  'test.sentThrough': 'This message was sent through {{server}} because {{admin}} asked for a test in the admin settings.',
  'test.nothingToDo': "There is nothing to do. If you weren't expecting it, you can ignore it.",
  'newsletter.footer.why': 'You receive this newsletter because you signed up for it in your {{appName}} settings.',
  'newsletter.unsubscribe': 'Unsubscribe',
  'newsletter.open': 'Open in {{appName}}',
  'newsletter.runtime': '{{minutes}} min',
  'newsletter.fact.genres': 'Genres',
  'newsletter.fact.rating': 'Rating',
  'newsletter.fact.languages': 'Languages',
  'newsletter.fact.countries': 'Countries',
  'newsletter.fact.director': 'Directed by',
  'newsletter.fact.creator': 'Created by',
  'newsletter.fact.cast': 'Starring',
  'newsletter.fact.network': 'Network',
  'newsletter.passage.plot': 'Plot',
  'newsletter.passage.analysis': 'Analysis',
  'newsletter.page.confirmHeading': 'Stop receiving newsletters?',
  'newsletter.page.confirmBody': 'You will no longer get {{appName}} newsletters. You can switch them back on in your settings at any time.',
  'newsletter.page.doneHeading': 'You are unsubscribed',
  'newsletter.page.doneBody': 'You will not receive any more {{appName}} newsletters. You can switch them back on in your settings.',
  'newsletter.page.alreadyBody': 'You are not subscribed to {{appName}} newsletters, so there is nothing to do.',
  'newsletter.page.unknownHeading': 'This link does not work',
  'newsletter.page.unknownBody': 'It may be incomplete. You can switch newsletters off in your {{appName}} settings instead.',
} as const satisfies Record<string, string>

export type EmailStringKey = keyof typeof EN

type Translations = Partial<Record<EmailStringKey, string>>

const TRANSLATIONS: Readonly<Record<Exclude<AppLocaleCode, 'en'>, Translations>> = {
  es: {
    'footer.automated': '{{appName}} envió este correo automáticamente.',
    'action.openApp': 'Abrir {{appName}}',
    'test.subject': '{{appName}}: correo de prueba',
    'test.preheader': 'El correo saliente funciona.',
    'test.heading': 'El correo saliente funciona',
    'test.sentThrough':
      'Este mensaje se envió a través de {{server}} porque {{admin}} pidió una prueba en la configuración de administración.',
    'test.nothingToDo': 'No hay nada que hacer. Si no lo esperabas, puedes ignorarlo.',
  },
  de: {
    'footer.automated': 'Diese E-Mail wurde automatisch von {{appName}} gesendet.',
    'action.openApp': '{{appName}} öffnen',
    'test.subject': '{{appName}}: Test-E-Mail',
    'test.preheader': 'Ausgehende E-Mails funktionieren.',
    'test.heading': 'Ausgehende E-Mails funktionieren',
    'test.sentThrough':
      'Diese Nachricht wurde über {{server}} gesendet, weil {{admin}} in den Admin-Einstellungen einen Test angefordert hat.',
    'test.nothingToDo': 'Es ist nichts zu tun. Falls du sie nicht erwartet hast, kannst du sie ignorieren.',
  },
  fr: {
    'footer.automated': 'Cet e-mail a été envoyé automatiquement par {{appName}}.',
    'action.openApp': 'Ouvrir {{appName}}',
    'test.subject': '{{appName}} : e-mail de test',
    'test.preheader': 'L’envoi d’e-mails fonctionne.',
    'test.heading': 'L’envoi d’e-mails fonctionne',
    'test.sentThrough':
      'Ce message a été envoyé via {{server}} parce que {{admin}} a demandé un test dans les paramètres d’administration.',
    'test.nothingToDo': 'Il n’y a rien à faire. Si vous ne l’attendiez pas, vous pouvez l’ignorer.',
  },
  it: {
    'footer.automated': 'Questa email è stata inviata automaticamente da {{appName}}.',
    'action.openApp': 'Apri {{appName}}',
    'test.subject': '{{appName}}: email di prova',
    'test.preheader': "L'invio delle email funziona.",
    'test.heading': "L'invio delle email funziona",
    'test.sentThrough':
      'Questo messaggio è stato inviato tramite {{server}} perché {{admin}} ha richiesto una prova nelle impostazioni di amministrazione.',
    'test.nothingToDo': "Non c'è nulla da fare. Se non te lo aspettavi, puoi ignorarlo.",
  },
  pt: {
    'footer.automated': 'Este e-mail foi enviado automaticamente por {{appName}}.',
    'action.openApp': 'Abrir {{appName}}',
    'test.subject': '{{appName}}: e-mail de teste',
    'test.preheader': 'O envio de e-mails está funcionando.',
    'test.heading': 'O envio de e-mails está funcionando',
    'test.sentThrough':
      'Esta mensagem foi enviada por meio de {{server}} porque {{admin}} pediu um teste nas configurações de administração.',
    'test.nothingToDo': 'Não há nada a fazer. Se não estava esperando por ela, pode ignorá-la.',
  },
  nl: {
    'footer.automated': 'Deze e-mail is automatisch verstuurd door {{appName}}.',
    'action.openApp': '{{appName}} openen',
    'test.subject': '{{appName}}: test-e-mail',
    'test.preheader': 'Uitgaande e-mail werkt.',
    'test.heading': 'Uitgaande e-mail werkt',
    'test.sentThrough':
      'Dit bericht is verstuurd via {{server}} omdat {{admin}} in de beheerinstellingen om een test heeft gevraagd.',
    'test.nothingToDo': 'Je hoeft niets te doen. Als je dit niet verwachtte, kun je het negeren.',
  },
  ru: {
    'footer.automated': 'Это письмо отправлено автоматически приложением {{appName}}.',
    'action.openApp': 'Открыть {{appName}}',
    'test.subject': '{{appName}}: тестовое письмо',
    'test.preheader': 'Исходящая почта работает.',
    'test.heading': 'Исходящая почта работает',
    'test.sentThrough':
      'Это сообщение отправлено через {{server}}, потому что {{admin}} запросил(а) проверку в настройках администратора.',
    'test.nothingToDo': 'Ничего делать не нужно. Если вы его не ждали, просто проигнорируйте.',
  },
  ja: {
    'footer.automated': 'このメールは {{appName}} から自動送信されました。',
    'action.openApp': '{{appName}} を開く',
    'test.subject': '{{appName}}: テストメール',
    'test.preheader': 'メール送信は正常に動作しています。',
    'test.heading': 'メール送信は正常に動作しています',
    'test.sentThrough': 'このメッセージは、{{admin}} が管理設定でテストを実行したため、{{server}} 経由で送信されました。',
    'test.nothingToDo': '対応は不要です。心当たりがない場合は無視してください。',
  },
  zh: {
    'footer.automated': '此邮件由 {{appName}} 自动发送。',
    'action.openApp': '打开 {{appName}}',
    'test.subject': '{{appName}}：测试邮件',
    'test.preheader': '外发邮件工作正常。',
    'test.heading': '外发邮件工作正常',
    'test.sentThrough': '由于 {{admin}} 在管理设置中请求了测试，此消息已通过 {{server}} 发送。',
    'test.nothingToDo': '无需任何操作。如果这不在你的预期之中，可以忽略它。',
  },
  ko: {
    'footer.automated': '이 이메일은 {{appName}}에서 자동으로 보냈습니다.',
    'action.openApp': '{{appName}} 열기',
    'test.subject': '{{appName}}: 테스트 이메일',
    'test.preheader': '발신 이메일이 정상적으로 작동합니다.',
    'test.heading': '발신 이메일이 정상적으로 작동합니다',
    'test.sentThrough': '{{admin}}님이 관리자 설정에서 테스트를 요청하여 {{server}}을(를) 통해 이 메시지를 보냈습니다.',
    'test.nothingToDo': '따로 하실 일은 없습니다. 예상하지 못한 메일이라면 무시하셔도 됩니다.',
  },
  hi: {
    'footer.automated': 'यह ईमेल {{appName}} द्वारा अपने आप भेजा गया है।',
    'action.openApp': '{{appName}} खोलें',
    'test.subject': '{{appName}}: परीक्षण ईमेल',
    'test.preheader': 'आउटगोइंग ईमेल काम कर रहा है।',
    'test.heading': 'आउटगोइंग ईमेल काम कर रहा है',
    'test.sentThrough':
      'यह संदेश {{server}} के माध्यम से भेजा गया, क्योंकि {{admin}} ने एडमिन सेटिंग्स में परीक्षण का अनुरोध किया।',
    'test.nothingToDo': 'कुछ करने की ज़रूरत नहीं है। अगर आपको इसकी उम्मीद नहीं थी, तो आप इसे अनदेखा कर सकते हैं।',
  },
  ar: {
    'footer.automated': 'أُرسلت هذه الرسالة تلقائيًا بواسطة {{appName}}.',
    'action.openApp': 'فتح {{appName}}',
    'test.subject': '{{appName}}: بريد اختباري',
    'test.preheader': 'البريد الصادر يعمل.',
    'test.heading': 'البريد الصادر يعمل',
    'test.sentThrough': 'أُرسلت هذه الرسالة عبر {{server}} لأن {{admin}} طلب اختبارًا من إعدادات المسؤول.',
    'test.nothingToDo': 'لا حاجة لأي إجراء. إذا لم تكن تتوقعها، يمكنك تجاهلها.',
  },
  el: {
    'footer.automated': 'Αυτό το email στάλθηκε αυτόματα από το {{appName}}.',
    'action.openApp': 'Άνοιγμα του {{appName}}',
    'test.subject': '{{appName}}: δοκιμαστικό email',
    'test.preheader': 'Η αποστολή email λειτουργεί.',
    'test.heading': 'Η αποστολή email λειτουργεί',
    'test.sentThrough':
      'Αυτό το μήνυμα στάλθηκε μέσω του {{server}} επειδή ο/η {{admin}} ζήτησε δοκιμή από τις ρυθμίσεις διαχείρισης.',
    'test.nothingToDo': 'Δεν χρειάζεται να κάνετε τίποτα. Αν δεν το περιμένατε, μπορείτε να το αγνοήσετε.',
    'newsletter.footer.why':
      'Λαμβάνετε αυτό το ενημερωτικό δελτίο επειδή εγγραφήκατε σε αυτό από τις ρυθμίσεις σας στο {{appName}}.',
    'newsletter.unsubscribe': 'Διαγραφή από τη λίστα',
    'newsletter.open': 'Άνοιγμα στο {{appName}}',
    'newsletter.runtime': '{{minutes}} λεπτά',
    'newsletter.fact.genres': 'Είδη',
    'newsletter.fact.rating': 'Βαθμολογία',
    'newsletter.fact.languages': 'Γλώσσες',
    'newsletter.fact.countries': 'Χώρες',
    'newsletter.fact.director': 'Σκηνοθεσία',
    'newsletter.fact.creator': 'Δημιουργία',
    'newsletter.fact.cast': 'Πρωταγωνιστούν',
    'newsletter.fact.network': 'Δίκτυο',
    'newsletter.passage.plot': 'Υπόθεση',
    'newsletter.passage.analysis': 'Ανάλυση',
    'newsletter.page.confirmHeading': 'Διακοπή των ενημερωτικών δελτίων;',
    'newsletter.page.confirmBody':
      'Δεν θα λαμβάνετε πλέον ενημερωτικά δελτία του {{appName}}. Μπορείτε να τα ενεργοποιήσετε ξανά από τις ρυθμίσεις σας όποτε θέλετε.',
    'newsletter.page.doneHeading': 'Η εγγραφή σας ακυρώθηκε',
    'newsletter.page.doneBody':
      'Δεν θα λαμβάνετε άλλα ενημερωτικά δελτία του {{appName}}. Μπορείτε να τα ενεργοποιήσετε ξανά από τις ρυθμίσεις σας.',
    'newsletter.page.alreadyBody': 'Δεν είστε εγγεγραμμένοι στα ενημερωτικά δελτία του {{appName}}, οπότε δεν χρειάζεται κάτι.',
    'newsletter.page.unknownHeading': 'Αυτός ο σύνδεσμος δεν λειτουργεί',
    'newsletter.page.unknownBody':
      'Ίσως είναι ελλιπής. Μπορείτε να απενεργοποιήσετε τα ενημερωτικά δελτία από τις ρυθμίσεις σας στο {{appName}}.',
  },
}

/** The English source, for tests that hold every translation to its keys and placeholders. */
export const EMAIL_STRINGS_EN: Readonly<Record<EmailStringKey, string>> = EN
export const EMAIL_STRING_TRANSLATIONS: Readonly<Record<string, Translations>> = TRANSLATIONS

export interface EmailLocale {
  code: AppLocaleCode
  rtl: boolean
}

/** A supported locale for an email, from whatever the caller holds; anything unknown is English. */
export function emailLocale(code: string | null | undefined): EmailLocale {
  const normalized = normalizeAppLocale((code ?? '').split(/[-_]/)[0])
  return { code: normalized, rtl: isRtlLocale(normalized) }
}

/**
 * One string in `locale`, falling back to English for a key the locale does
 * not translate, with `{{name}}` filled from `vars`. A placeholder with no
 * value becomes empty rather than staying as braces in someone's inbox.
 */
export function emailText(
  locale: AppLocaleCode,
  key: EmailStringKey,
  vars: Readonly<Record<string, string>> = {}
): string {
  const template = (locale === 'en' ? undefined : TRANSLATIONS[locale]?.[key]) ?? EN[key]
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '')
}
