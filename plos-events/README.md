# PERSONAL LIFE OS — Events Calendar

Web interface for PERSONAL LIFE OS event discovery results.

## Features
- Numbered events (#1, #2, ...)
- Per-event selection checkbox and bulk actions
- Per-event invite checkbox
- Direct `➕ Google Calendar` prefilled link
- `ΛΕΜΕΣΟΣ` badge for Limassol events
- `ΗΔΗ ΣΤΟ ΗΜΕΡΟΛΟΓΙΟ` red badge for events already added through this app
- Add selected events to Google Calendar
- Send RSVP invitations via email
- Delete selected or individual events from Google Calendar
- Original source link for every event where available

## Required Render environment variables for direct Google Calendar actions
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (optional, defaults to `primary`)
- `DEFAULT_INVITEE` (optional, defaults to `sflourentzou@gmail.com`)

Event discovery data is stored in `events.json` and can be refreshed from ChatGPT event searches without relying on Floot build actions.
