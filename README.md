# G-Cal Project Guide

This guide provides a step-by-step process to set up your development environment, configure the required APIs, and execute the script to efficiently clear and manage your organization’s internal Google Calendar events.

---

## Overview and Premises

### Project Goals and Scope

The primary objective of this project is to implement a script that clears internal calendar events for the organization’s users, starting from specified date. By removing recurring and internal meetings scheduled after this date, the company aims to:

- Streamline scheduling practices.
- Reduce unnecessary meeting room usage.
- Encourage employees to reassess the necessity of their meetings.

The script is designed to support relatively big number of user and to minimize disruption to external meetings or exempted users/teams.

---

### Constraints and Requirements

To meet the company’s objectives while maintaining data integrity, the following key requirements must be addressed:

#### Preservation of External Meetings
- Meetings involving **external participants** (emails outside the company domain) must remain untouched.

#### Preservation of Personal and Out of Office Events
- Personal meetings involving **no participants** (only the author) or **out of office events** must remain untouched.

#### Handling Recurring Events
- For recurring meetings, only instances **scheduled after specified date** should be removed, leaving historical and current occurrences unaffected.

#### Exemptions for Specific Teams/Users
- Certain users (emails) may require **exemption** from the script’s actions.
- These exemptions should be **configurable**, allowing for updates based on business needs.

#### Scalability for Large User Base
- The solution must efficiently handle a high volume of calendar data while adhering to:
  - **Google Calendar API rate limits**.
  - **Google App Script execution time limits**.
