# Letterhead

Your email on your Mac: a full inbox you can use instead of the Gmail website, a mail merge for outreach, and an optional assistant that drafts replies in your own writing style.

Letterhead 2 keeps everything from 1.x (mail merge, sending your drafts, scheduled batches, the daily cap, keeping your Mac awake and automatic updates) and adds **Mail** and the **Reply assistant**.

## Which app do I open?

- **Apple Silicon** (M1, M2, M3, M4 and newer): use `Letterhead-...-AppleSilicon.zip`, or the `Letterhead for Apple Silicon` folder in the combined zip.
- **Intel Mac**: use `Letterhead-...-Intel.zip`, or the `Letterhead for Intel` folder.

Not sure? Click the Apple menu, then **About This Mac**. If it says "Chip: Apple M...", use Apple Silicon. If it says "Processor: Intel", use Intel.

Drag `Letterhead.app` into your **Applications** folder and open it from there. Updates can only install when it runs from Applications (or another folder you can write to), not straight from Downloads or a disk image.

## Opening it the first time

Letterhead is not signed with a paid Apple developer certificate, so macOS asks you to confirm the first time.

1. In Applications, **right-click** (or Control-click) Letterhead and choose **Open**, then click **Open** again.
2. On newer macOS versions (Sequoia and later) that menu may only show "Done" or "Move to Trash". If so, click **Done**, open **System Settings > Privacy & Security**, scroll down, and click **Open Anyway** next to the Letterhead message. Then open the app again.
3. If macOS says the app "is damaged", open Terminal and run this once, then open it again:

   ```
   xattr -cr /Applications/Letterhead.app
   ```

After the first time it opens normally.

## Making a Gmail App Password

Gmail does not let apps sign in with your normal password. You make a separate 16 letter App Password just for Letterhead.

1. Turn on **2-Step Verification** for your Google Account at https://myaccount.google.com/security if it is not already on. App Passwords only appear once it is on.
2. Go to https://myaccount.google.com/apppasswords and sign in.
3. Type a name such as `Letterhead` and click **Create**.
4. Copy the 16 letter code Google shows you. You will not see it again, but you can always make a new one.
5. In Letterhead, open **Account**, choose **Gmail**, enter your name, your Gmail address, and paste the code into **App password**. Click **Save account**. Letterhead checks the login before it saves.

If the App Passwords page says the setting is not available, the account is probably run by a school or employer that has turned it off. A personal Gmail account works best.

To stop Letterhead from using your account, delete the App Password on that same Google page, or click **Forget account** in Letterhead.

## Using it

1. **Recipients**: click **Import CSV** (or drop a CSV on the window), or **Paste a list** straight from Google Sheets. You need a column called `email`. Every other column becomes a merge field, so a column called `University` becomes `{{university}}`.
2. **Letter**: write the subject and body. Click a field chip to insert it. The preview on the right shows exactly what each person gets. Use the arrows to flip through people. A yellow note tells you if anyone has a blank field. Write `{{university|your university}}` to use fallback words when a cell is empty. Attach a file such as your resume with **Attach a file**.
3. **Send test to myself** sends one filled in copy to your own address, so you can see it in your inbox first.
4. **Send**: choose **All at once** or **On an interval** (for example one every 2 minutes, with each gap varied by up to 25% so it does not look robotic). Click **Start sending**.
5. While sending you can **Pause**, **Resume**, or **Cancel**. Anything that fails shows the server's reason, and **Retry failed** tries those again. **Export results** saves a CSV of who was sent what and when.

Keep Letterhead open while it sends. Closing the window is fine: on a Mac, Letterhead keeps running in the background (click its Dock icon to bring the window back). If you quit or your Mac goes to sleep, sending stops. Anything already sent stays sent.

## Mail

Click **Inbox** in the sidebar. Letterhead uses the account you already set up (the same App Password) over IMAP and SMTP.

- **Folders and labels**: Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash and your Gmail labels.
- **Live**: new mail shows up as it arrives (IMAP IDLE), with a notification for personal mail and an unread count on the Dock icon. It also checks every 3 minutes in case the live connection drops.
- **Conversations**: messages are grouped the way Gmail groups them. Older messages are folded; click one to open it.
- **Safe reading**: emails are shown in a locked down frame where scripts cannot run. Remote images are blocked until you click **Show images**, because they can tell a sender you opened the email. **Always from this sender** remembers your choice.
- **Attachments**: **Open** or **Save** each one.
- **Search** uses Gmail's own search, so `from:`, `to:`, `subject:`, `has:attachment` and `older_than:7d` work.
- **Actions**: archive, delete, spam, mark unread, star, move and label.
- **Write**: **Compose** (or press `c`), **Reply**, **Reply all** and **Forward**, with bold, italics, links, lists, attachments and your signature (set it in **Settings**). Drafts save to your Drafts folder every few seconds. **Command Return** sends, and you get a few seconds to **Undo**.
- **Offline**: recent mail is kept in a local database on your Mac, so it opens fast and you can read it without internet.

Keyboard shortcuts (press `?` for the list): `j`/`k` next and previous, `o` open, `u` back, `e` archive, `#` delete, `!` spam, `s` star, `Shift I`/`Shift U` read/unread, `x` select, `v` move, `l` label, `r` reply, `a` reply all, `f` forward, `c` compose, `/` search, `g` then `i`/`t`/`d` for Inbox, Sent, Drafts.

## Reply assistant (optional, off until you turn it on)

The assistant learns how you write from your Sent mail and drafts replies that sound like you. You read every draft before it goes, unless you set up automatic replies.

**Setting it up (about two minutes)**

1. Get a free Gemini API key: open [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey), sign in with your Google account and click **Create API key**. Copy it.
2. In Letterhead, open **Assistant**, turn on **Use the reply assistant**, paste the key and click **Save**, then **Test the key**. macOS may ask about Letterhead's Keychain item; click **Always Allow**.
3. Under **Learn your style**, choose how many sent emails to read (500 to 2,000) and click **Build my style profile**. Reading and measuring happens on your Mac. Then a sample of up to 45 of your emails goes to Gemini, in small batches, to describe your tone. You can edit the result.
4. Add a few facts in **About you** (school, grade, when you are free). When the assistant needs a fact it does not have, it writes a [placeholder] in brackets instead of guessing.

**Using it**

- In any conversation, click **Draft reply**. Then **Send**, **Edit in composer**, **Regenerate**, **Shorter** or **More formal**.
- New personal mail gets a draft in the background (up to 40 a day by default). They are listed in **Suggested replies**.
- OpenAI and Anthropic keys work too: pick the provider on the Assistant page.

**Automatic replies** are off by default. When you turn them on, they only apply to rules you write (certain senders like `@stanford.edu`, or certain labels). Each reply waits in **Suggested replies** for the time you pick (10 minutes to 8 hours) so you can **Stop** or edit it, and there is a daily limit. They are never sent to no-reply addresses, mailing lists, newsletters, automated or bulk mail, out-of-office replies, emails to more than 5 people, mail older than a day, or the same person twice in 24 hours. They stop if you reply yourself first. Every automatic reply, and every one that was skipped or stopped, is in the log. They carry an `Auto-Submitted: auto-replied` header so other mail systems do not answer them.

**Privacy**: to write a reply, Letterhead sends the email you are answering, earlier messages in that conversation, a few similar past replies of yours and your style notes to the provider you chose, with your own key. Google's Gemini API terms say that with a free key, Google uses what you send to improve its products and human reviewers may read it after disconnecting it from your account; with billing turned on, it does not. For anything private, write that reply yourself. The Sent mail index, style profile and drafts stay on your Mac. Your key is encrypted with your macOS Keychain and never leaves your Mac except in requests to that provider.

**Free tier limits**: Gemini's free keys allow only a handful of requests per minute. Letterhead uses `gemini-3.1-flash-lite` first and switches to `gemini-3.5-flash` when one is busy or out of quota, waits and retries when Google asks it to, and builds your style profile slowly so it stays inside the limit. If drafts say the quota is used up, wait a minute or add billing to your key.

## Sending drafts you already wrote

If you write your emails in Gmail and leave them as drafts, Letterhead can send them for you on a schedule.

1. Open the **Drafts** tab. Letterhead reads your Drafts folder over IMAP with the same email address and App Password you set up for sending. Nothing extra to enter for Gmail or iCloud. For **Other SMTP**, fill in the IMAP server on the Account tab (usually port 993, SSL/TLS).
2. Every draft shows who it is to, the subject, the first line, and any attachments. Click one to preview it. Tick the ones you want, or use **Select all**.
3. Drafts with nobody in To, Cc or Bcc are marked in red and skipped. They stay in your Drafts folder.
4. Click **Send**, pick **All at once** or **On an interval**, then start. Pause, resume, cancel, retry and export work the same as for mail merge.

Each draft goes out exactly as you wrote it: its own To, Cc and Bcc, subject, formatting and attachments. Bcc addresses get the email but are not shown to anyone else.

After a draft sends, Letterhead removes it from Drafts so you do not send it twice. You can turn this off in **Settings**. Gmail puts a copy in Sent automatically. For other providers, Letterhead saves a copy to your Sent folder (also a setting, in case your provider already does this and you see doubles).

**Gmail and IMAP:** Google's help page says IMAP has been always on for personal Gmail accounts since January 2025, so there is usually nothing to turn on. Older guides tell you to enable IMAP under Gmail Settings > See all settings > Forwarding and POP/IMAP. If you still see that option, make sure it says Enable IMAP. School or work Google accounts can have IMAP turned off by an admin.

## Scheduling batches for later

A batch is a send you set up now and Letterhead starts at a time you pick. You can line up as many as you like, each with its own time and pace. For example, Stanford labs Tuesday at 8:00 AM, MIT follow ups Wednesday at 9:30 AM, and a set of drafts Friday afternoon.

1. Set up what to send as usual: a list and a letter, or drafts ticked on the Drafts tab.
2. On the **Send** tab click **Schedule for later**, or open the **Schedule** tab and click **New batch**.
3. Give it a name, pick the date, time and time zone (your Mac's zone is chosen for you), and a pace. Quick picks like **Tomorrow, 8:00 AM** fill in the time for you. Click **Schedule batch**.

What gets saved:
- **Mail merge batches** keep their own copy of the list and the letter. You can change the Letter tab for the next batch without touching ones already scheduled.
- **Drafts batches** remember which drafts you picked and read each one fresh from your Drafts folder when it sends. Edits you make in Gmail before then go out too. A draft you delete in the meantime shows up as failed with a note, and nothing is sent for it.

On the Schedule tab every batch shows its status (Scheduled, Up next, Sending, Paused, Missed, Done, Failed or Cancelled) and a countdown. You can **Edit**, **Duplicate**, **Send now**, **Reschedule**, **Cancel**, **Retry failed** and **Export** results for each one.

How batches behave:
- **One at a time.** If two batches are due together, the second starts when the first finishes. A send you start by hand on the Send tab takes the same slot.
- **Shared daily cap.** All batches count toward the cap in Settings. A batch that reaches it pauses, then picks up again by itself once the 24 hour window has room.
- **Letterhead must be open.** Closing the window is fine, quitting is not. Turn on **Open at login** on the Schedule tab so a restart does not stop your schedule.
- **Nothing goes out by surprise.** If Letterhead was closed or your Mac was asleep when a batch was due, it does not send it later on its own. Next time it opens (or the Mac wakes), it asks you: **Send now**, **Reschedule**, or **Cancel batch**. A batch that was cut off partway resumes with the people it had not reached yet. Anyone who was mid send at that moment is marked failed with a note, so check Sent before you retry them.
- Notifications tell you when a batch starts and when it finishes.

## Keeping your Mac awake

A sleeping Mac cannot send. On the **Schedule** tab:

- **Keep Mac awake while batches wait** keeps the Mac from going to sleep on its own from the moment a batch is scheduled until the queue is empty (it uses the built in `caffeinate` tool). The screen can still turn off. A send in progress always keeps the Mac awake, even with this off.
- **Even with the lid closed** also stops sleep when you close the lid. macOS only allows this for an administrator, so Letterhead asks for your Mac password once (a normal macOS password box). It then runs `pmset -a disablesleep 1`, along with a small helper that sets it back to `0` as soon as the queue is done, you turn the switch off, or Letterhead quits or crashes. Choose whether the password box appears **When I schedule** (the default, so you are there to type it) or **15 min before** the next batch (only useful if you will be at the Mac then). A moon badge in the sidebar shows while lid closed mode is on.
- With the lid closed, keep the Mac **plugged in** and **out of a bag or sleeve**. It keeps running and can get warm.
- If sleep ever seems stuck off, click **Restore normal sleep** (also in the **Sending** menu). It runs `pmset -a disablesleep 0`. Letterhead also checks at launch and warns you if sleep is still turned off. The same thing by hand in Terminal: `sudo pmset -a disablesleep 0`.

## Updates

Letterhead updates itself. When it opens, and every 4 hours after that, it checks the project's GitHub Releases page for a newer version. If there is one, it downloads the right copy for your Mac in the background, checks the file against the SHA-256 checksum published with the release, and makes sure it really is Letterhead. Then it shows **Update ready, restart**. Click **Restart to update** and it swaps in the new copy and reopens. Or click **Later** and it installs the next time you quit. The version and a **Check now** button are in **Settings**, and there is **Check for Updates...** in the Letterhead menu. While a send is running, Letterhead waits for it to finish before it restarts.

Updates do not touch your account, lists, letters or batches.

After an update, macOS may ask once more whether Letterhead can use its Keychain item, because each build has a new ad hoc signature. Click **Always Allow**. You might also need to confirm opening it, as on the first launch.

If an update fails with "ENOTDIR: not a directory" (a bug in versions 1.1.0 and 2.0.0 that shows up when an earlier download is still in the updates folder), quit Letterhead, delete the folder `~/Library/Application Support/Letterhead/updates`, open Letterhead again and click **Check now**. From 2.0.1 on, Letterhead clears old downloads itself, unpacks each attempt into its own new folder, and if staging fails it wipes the updates folder and tries once more. Details of each attempt are in `updates/update.log`.

Why not Apple's standard updater: it only works for apps signed with a paid Apple Developer ID, so Letterhead uses its own small one.

## Limits

Google's help pages list a limit of 500 emails per rolling 24 hours for personal Gmail accounts (2,000 for Google Workspace). Letterhead's daily cap in **Settings** defaults to 500 and pauses sending when it is reached. It only counts mail sent from Letterhead, so leave some room for your normal email. A draft addressed to three people counts as three.

## Where your data lives

Everything stays on your Mac in `~/Library/Application Support/Letterhead`. Your password and AI key are encrypted using the macOS Keychain. The mail cache is `mail.sqlite` and the `mailcache` folder; your style profile is `style.json`. Letterhead talks only to the mail server you set up, the AI provider you chose (only when the assistant is on), plus github.com to check for updates (turn off **Download updates automatically** in Settings to stop that; **Check now** still works). Scheduled batches are in `batches.json` in the same folder. macOS may ask once whether Letterhead can use its Keychain item; click **Always Allow**.
