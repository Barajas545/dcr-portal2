// site-config.js — what the company sets for every copy of the app, as opposed
// to what each person sets in Settings (js/ui/settings.js).
//
// PLANS_SOURCE — where plan files come from by default.
//
//   'sharepoint'  through the employee portal: its project Files tab, its
//                 search and its Plans Library hand a project over to this
//                 app. That is how it has always worked, and it stays the
//                 default until the plans have moved.
//   'folder'      the Plans Archive folder on each computer — a synced
//                 OneDrive folder holding one folder per project. The start
//                 screen then leads with it, and the portal's saved copies
//                 (mirrors of the old SharePoint files) are no longer listed.
//
// Changing this line is the whole switch for the app. Each person can still
// choose for their own device in Settings, which is how the folder is tried
// before the switch and how one device is kept on the old way after it.
export const PLANS_SOURCE = 'folder';
