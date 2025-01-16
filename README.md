# G-Cal Project Guide

This guide provides a step-by-step process to set up your development environment, configure the required APIs, and execute the script to efficiently clear and manage your organization’s internal Google Calendar events.

## Overview and Premises

### Project Goals and Scope

The primary objective of this project is to implement a script that clears internal calendar events for the organization’s users, **starting from a specified date**. By removing recurring and internal meetings scheduled after this date, the company aims to:

- Reduce unnecessary meeting room usage.
- Encourage employees to reassess the necessity of their meetings.

The script is designed to support a **relatively large number of users** and to minimize disruption to external meetings or exempted users/emails.

### Constraints and Requirements

To meet the company’s objectives while maintaining data integrity, the following key requirements must be addressed:

#### Preservation of External Meetings
- Meetings involving **external participants** (emails outside the company domain) must remain untouched.

#### Preservation of Personal and Out of Office Events
- Personal meetings involving **no participants** (only the author) or **out of office events** must remain untouched.

#### Handling Recurring Events
- For recurring meetings, only instances **scheduled after the specified date** should be removed, leaving historical and current occurrences unaffected.

#### Exemptions for Specific Teams/Users
- Certain users (emails) may require **exemption** from the script’s actions.
- These exemptions should be **configurable**, allowing for updates based on business needs.

#### Scalability for Large User Base
- The solution must efficiently handle a high volume of calendar data while adhering to:
  - **Google Calendar API rate limits**.
  - **Google Apps Script execution time limits**.

## Environment Setup

### Prerequisites
To run this script, you need the following:

1. **Google Workspace Super Admin Access**:
   - Required to access all users' calendars in the domain.

2. **Google Workspace APIs Enabled**:
   - Ensure that the following APIs are enabled for your project:
     - Google Calendar API
     - Admin SDK API

3. **Google Apps Script Editor**:
   - You can access this via your Google Workspace account at [Google Apps Script](https://script.google.com/).

4. **Project Scopes**:
   - Add the following OAuth scopes to your project:
     - `https://www.googleapis.com/auth/admin.directory.user.readonly`
     - `https://www.googleapis.com/auth/calendar`

### Steps to Run the Script

#### **Step 1: Enable APIs in Google Cloud Console**
1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Navigate to **APIs & Services** > **Library**.
4. Search for and enable the following APIs:
   - **Google Calendar API**
   - **Admin SDK API**

#### **Step 2: Create an Apps Script Project**
1. Go to [Google Apps Script Editor](https://script.google.com/).
2. Create a new project.
3. Add the `appsscript.json` and `CalendarCleanup.js` files provided in this repository to the editor.

#### **Step 3: Test the Script**
1. Set the `testRun` variable to `true` in the script.
2. **Add the list of exempted emails** to the `exemptedUsers` list.
3. Run the script to log actions without applying changes.
4. Verify the logs for expected classifications and actions.

#### **Step 4: Apply Changes**
1. Once satisfied with the test results, set the `testRun` variable to `false`.
2. Execute the script to apply changes.

## General Tips

- **Test Mode**: Always set `testRun` to `true` during initial testing to ensure actions are logged without changes.
- **Detailed Logs**: Use logs to identify and classify events before applying changes.

## Troubleshooting

### **1. No Events Found**
- **Cause**: Incorrect date range or no matching events.
- **Resolution**:
  1. Verify the `fromDate` variable to ensure the correct start date is set.

### **2. Google API Rate Limits**
- **Observation**: During testing, no issues were encountered even when processing thousands of events.
- **Resolution**: If a rate limit error occurs:
  1. Wait a few minutes and rerun the script.
  2. The script will continue processing remaining events.

### **3. Execution Time Limits**
- **Cause**: Google Apps Script execution time is capped at 6 minutes per execution, as stated on the [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas) page.
- **Observation**: During testing, the script successfully ran for 10 or more minutes without interruptions (though this may vary).
- **Resolution**: If a time limit error occurs:
  1. Wait a few minutes and rerun the script.
  2. The script will continue processing remaining events.
