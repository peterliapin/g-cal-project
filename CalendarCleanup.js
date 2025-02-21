const fromDate = new Date(2025, 1, 17); // February 10, 2025
const exemptedUsers = []; // Add emails for exempted users
const testRun = false; // Set to true for testing without applying changes
const preserveEventsWithExemptedAttendees = false; // Preserve events with exempted attendees if true
const restartFromBeginning = true; // Set to true to restart from the beginning
const secondaryCalendarsIds = ["c_3391b7096bfa79195e3fbf5357b45d19ae82c258785e1e477cfd6255215af14a@group.calendar.google.com"];

const excludedOUs = [
  //"/2FA Exception/Login Only/Terminated"
];

function readAndCancelEvents() {
  const allCalendars = getAllCalendars();
  //const allCalendars = ["senior-manager1@liapin.space"]
  const companyDomains = extractUniqueDomains(allCalendars);
  console.log(`Company domains: ${companyDomains.join(', ')}`);

  const scriptProps = PropertiesService.getScriptProperties();

  if (restartFromBeginning) {
    scriptProps.deleteProperty('LAST_PROCESSED_EMAIL');
    console.log('Reset requested. Deleted LAST_PROCESSED_EMAIL from PropertiesService.');
  }

  let lastProcessedEmail = scriptProps.getProperty('LAST_PROCESSED_EMAIL') || '';
  console.log(`Resuming from last processed email = "${lastProcessedEmail}"`);

  const sortedCalendars = allCalendars.slice().sort((a, b) => a.localeCompare(b));
  console.log(`Total calendars found: ${sortedCalendars.length}`);

  const remainingCalendars = sortedCalendars.filter(email => email > lastProcessedEmail);
  console.log(`Remaining calendars found: ${remainingCalendars.length}`);

  const totalUsers = remainingCalendars.length;
  let processedCount = 0;

  for (const userEmail of remainingCalendars) {
    try {
      processUserCalendar(userEmail, companyDomains);
      scriptProps.setProperty('LAST_PROCESSED_EMAIL', userEmail);
      processedCount++;
      console.log(`Processed ${processedCount} of ${totalUsers} calendars. Remaining: ${totalUsers - processedCount}`);
    } catch (error) {
      console.error(`Error processing calendar for ${userEmail}: ${error.message}`);
    }
  }
}

function processUserCalendar(userEmail, companyDomains) {
  if (exemptedUsers.includes(userEmail)) {
    console.log(`Skipping exempted user: ${userEmail}`);
    return;
  }

  console.info(`Processing calendar for: ${userEmail}`);
  try {
    const events = fetchCalendarEvents(userEmail).filter(event => {
      const organizerEmail = event.organizer?.email;
      const creatorEmail = event.creator?.email;
      return (organizerEmail === userEmail) || (creatorEmail === userEmail);
    });

    console.log(`Found ${events.length} events in ${userEmail}'s calendar.`);

    events
      .filter(event => !event.recurringEventId) // Process only master events
      .forEach(event => {
          const scenario = classifyEvent(event, companyDomains);

          if (
            scenario === "Internal/Recurring" ||
            scenario === "Internal/One-Time" ||
            scenario === "Exempted/AsAuthor/Recurring" ||
            scenario === "Exempted/AsAuthor/One-Time" ||
            scenario === "Exempted/AsAttendee/Recurring" ||
            scenario === "Exempted/AsAttendee/One-Time"
          ) {
            if (shouldCancelEvent(event, companyDomains)) {
              if (scenario.includes("Recurring")) {
                const eventStartDate = new Date(event.start.dateTime || event.start.date);

                if (eventStartDate >= fromDate) {
                  removeEvent(event, userEmail, scenario);
                } else {
                  updateRecurringEvent(event, userEmail, scenario);
                }
              } else {
                removeEvent(event, userEmail, scenario);
              }
            } else {
              logEventDetails(`Preserving event`, event, scenario);
            }
          } else {
            logEventDetails(`Preserving event`, event, scenario);
          }
      });
  } catch (error) {
    console.error(`Failed to process calendar for ${userEmail}: ${error.message}`);
  }
}

function getAllUsers() {
  const users = [];
  let pageToken;
  do {
    const response = AdminDirectory.Users.list({ customer: 'my_customer', maxResults: 500, pageToken });

    response.users?.forEach(user => {
      if (!excludedOUs.includes(user.orgUnitPath)) {
        users.push(user.primaryEmail);
        console.log(`Including user ${user.primaryEmail} from OU: ${user.orgUnitPath}`);
      } else {
        console.log(`Skipping user ${user.primaryEmail} from excluded OU: ${user.orgUnitPath}`);
      }
    });

    pageToken = response.nextPageToken;
  } while (pageToken);
  return users;
}

function getAllCalendars() {
  const users = getAllUsers();
  const all = new Set(users);

  // Fetch all calendars accessible to the script user
  const cl = Calendar.CalendarList.list().items || [];

  cl.forEach(c => {
    if (c.accessRole === 'owner' || c.accessRole === 'writer') {
      all.add(c.id);

      console.log(`Found "${c.summary}" calendar with access role = "${c.accessRole}" and id = "${c.id}"`);
    }
  });

  secondaryCalendarsIds.forEach(c => {
    all.add(c);
  });

  return [...all];
}

function extractUniqueDomains(users) {
  let userDomains = users.map(email => email.split('@')[1].toLowerCase());
  userDomains.push("resource.calendar.google.com");
  userDomains.push("group.calendar.google.com");
  return [...new Set(userDomains)];
}

function fetchCalendarEvents(calendarId) {
  return (
    Calendar.Events.list(calendarId, {
      timeMin: fromDate.toISOString(),
      maxResults: 10000,
      singleEvents: false
    }).items || []
  );
}

/**
 * Classifies an event into a scenario:
 * - External/Recurring or External/One-Time
 * - Internal/Recurring or Internal/One-Time
 * - Exempted/AsAuthor/Recurring or Exempted/AsAuthor/One-Time
 * - Exempted/AsAttendee/Recurring or Exempted/AsAttendee/One-Time
 * - Personal (no other attendees or only organizer as attendee)
 */
function classifyEvent(event, companyDomains) {
  const organizerEmail = event.organizer?.email;
  const creatorEmail = event.creator?.email;
  const isRecurring = !!event.recurrence;

  // Check if either organizer or creator is external
  const isOrganizerExternal = organizerEmail && 
    !companyDomains.some(domain => organizerEmail.toLowerCase().endsWith(domain));
  const isCreatorExternal = creatorEmail && 
    !companyDomains.some(domain => creatorEmail.toLowerCase().endsWith(domain));

  if (isOrganizerExternal || isCreatorExternal) {
    return isRecurring ? "External/Recurring" : "External/One-Time";
  }

  // Check if there's any attendee outside our domains
  const isExternal = event.attendees?.some(attendee =>
    !companyDomains.some(domain => attendee.email.toLowerCase().endsWith(domain))
  );

  if (isExternal) {
    return isRecurring ? "External/Recurring" : "External/One-Time";
  }

  // Check for exempted user scenarios when either organizer or creator is exempted
  if ((organizerEmail && exemptedUsers.includes(organizerEmail)) || 
      (creatorEmail && exemptedUsers.includes(creatorEmail))) {
    return isRecurring ? "Exempted/AsAuthor/Recurring" : "Exempted/AsAuthor/One-Time";
  }

// Check for exempted user scenarios when any attendee is exempted
  if (event.attendees?.some(attendee => exemptedUsers.includes(attendee.email))) {
    return isRecurring ? "Exempted/AsAttendee/Recurring" : "Exempted/AsAttendee/One-Time";
  }

// If no attendees (other than possibly the organizer), treat as personal
  if (!event.attendees || event.attendees.every(att => att.email === organizerEmail)) {
    return "Personal";
  }

  return isRecurring ? "Internal/Recurring" : "Internal/One-Time";
}

/**
 * Determines whether we should cancel (delete/modify) the given event,
 * applying our extra rule about exempted users in the attendee list.
 */
function shouldCancelEvent(event, companyDomains) {
  const organizerEmail = event.organizer?.email;
  const creatorEmail = event.creator?.email;

  const isPersonal = !event.attendees || (
    event.attendees.every(att => 
      (organizerEmail && att.email === organizerEmail) || 
      (creatorEmail && att.email === creatorEmail)
    )
  );

  // If external attendees exist, preserve
  const isExternal = event.attendees?.some(attendee =>
    !companyDomains.some(domain => attendee.email.toLowerCase().endsWith(domain))
  );

  if (isExternal || isPersonal) {
    return false;
  }

// If either organizer or creator is exempted, preserve the event
  if ((organizerEmail && exemptedUsers.includes(organizerEmail)) || 
      (creatorEmail && exemptedUsers.includes(creatorEmail))) {
    return false;
  }

  // If there is at least one exempted user in attendees,
  // and the global flag says "preserve" => do not cancel.
  const hasExemptedAttendee = event.attendees?.some(attendee =>
    exemptedUsers.includes(attendee.email)
  );

  return !(hasExemptedAttendee && preserveEventsWithExemptedAttendees);
}

function updateRecurringEvent(event, calendarId, scenario) {
  try {
    const updatedRecurrence = event.recurrence.map(rule => {
      if (rule.startsWith("RRULE:")) {
        const parts = rule.split(";");
        // Remove any existing UNTIL and COUNT
        const updatedParts = parts.filter(part => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));
        // Add a new UNTIL that matches fromDate
        updatedParts.push(`UNTIL=${fromDate.toISOString().split("T")[0].replace(/-/g, "")}`);
        return updatedParts.join(";");
      }
      return rule;
    });

    logEventDetails(`Recurring event to be updated`, event, scenario,
      `Old Recurrence: ${event.recurrence}
    New Recurrence: ${updatedRecurrence}`);

    if (!testRun) {
      const updatedEvent = {
        ...event,
        recurrence: updatedRecurrence
      };

      Calendar.Events.update(updatedEvent, calendarId, event.id);
      console.warn(`Updated recurring event to end by ${fromDate.toISOString()}: ${event.summary}, Scenario: ${scenario}`);
    }
  } catch (error) {
    console.error(`Failed to update recurring event: ${error.message}`);
  }
}

function removeEvent(event, calendarId, scenario) {
  try {
    logEventDetails(`${scenario} event to be removed`, event, scenario);

    if (!testRun) {
      Calendar.Events.remove(calendarId, event.id);
      console.warn(`Removed ${scenario} event: ${event.summary}, Scenario: ${scenario}`);
    }
  } catch (error) {
    console.error(`Failed to remove ${scenario} event: ${error.message}`);
  }
}

function logEventDetails(prefix, event, scenario, postfix = '') {
  console.log(`${prefix}: ${event.summary}, Scenario: ${scenario}
    Summary: ${event.summary}
    Start: ${event.start?.dateTime || event.start?.date}
    End: ${event.end?.dateTime || event.end?.date}
    Author/Creator: ${event.organizer?.email || event.creator?.email}
    Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}
    ${postfix}`);
}