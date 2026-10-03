# Conversations and dashboards

## Discussing a test or result

Open **Comments** on a saved web, API or mobile test, or on a test result in a report.
Members, including viewers, can participate when they can read that target. Conversations belong
to the current organization and follow the target's project permissions.

Write a **New comment** to start a conversation, or choose **Reply** on an open conversation.
Replies stay under the original message; there is one level of replies. Messages are plain text,
up to 5,000 characters.

Expand **Mention members** and select the people you want to mention, up to 20 per message.
The list contains members of this organization who can read the test or result. Their usernames
appear beside the message. Typing a username alone does not select a mention. When editing a
message, you can also change its selected mentions.

Use **Conversation filter** to show all conversations, open conversations, resolved conversations,
or conversations **Mentioning me**. A mention on a reply also includes its conversation in that
filter. Mentions are visible in the discussion and filter; there is no separate inbox or email
notification.

The author of the original message and organization owners can **Resolve conversation** or
**Reopen conversation**. A resolved conversation keeps its messages, but accepts new replies only
after reopening. Authors can edit or delete their own messages; owners can moderate them.
Deleting an original message that has replies leaves a **This comment was deleted** placeholder:
its body and mentions disappear, while other members' replies remain readable. A deleted original
message accepts no further replies. Deleting a saved test removes discussions on its historical
results while leaving reports available.

## Choosing and sharing dashboards

On **Dashboard**, select the dashboard you want to view. You can create several dashboards,
rename them, duplicate them, delete them, and choose your personal default. A duplicate is a
private copy that you can change independently. Your default selection applies to your account;
deleting a dashboard clears selections that referred to it.

| Visibility | Who can read it | Who can change or delete it |
|---|---|---|
| Private | Its creator | Its creator |
| Shared with organization | Members of the same organization | Its creator and organization owners |

Organization owners cannot open another member's private dashboard. Other members can duplicate
a shared dashboard into a private copy. Sharing a dashboard shares its configuration: each
reader still sees only the test and project data they can access. A widget configured for a
project the reader cannot access is shown as unavailable, without that project's name or counts.

Your existing personal layout becomes a private dashboard, retaining widget order and visibility.
Dashboards belong to their creator. Removing that member deletes their private and shared dashboards;
other members' references to those dashboards are cleared. Duplicate a shared dashboard before removing its creator if you need to retain it.
If you have no saved layout, your initial private dashboard contains the original five widgets:
metrics, execution status, trend, upcoming schedules and recent reports.

## Editing widgets

Choose **Customize dashboard** on a dashboard you can manage. Add or remove widgets, move them
up or down, show or hide them, and set their title and half or full width. You can add the same
widget type more than once, for example to compare projects or periods. A dashboard holds at most
20 widgets, including hidden widgets.

Available options depend on the widget:

- **Project ID (optional)** limits the data to an accessible project by its numeric ID; leaving it blank uses accessible data.
- **Period** accepts 1–365 days.
- **Result limit** accepts 1–50 items for recent reports or schedules.
- **Environment** filters upcoming schedules.

Save the layout to keep changes across sessions. If someone else has saved this dashboard since
you opened the editor, saving reports a conflict (HTTP 409) and keeps your draft. Reload the latest
dashboard and apply your changes again; the stale draft cannot overwrite the other person's save.
