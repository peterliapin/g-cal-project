const fromDate = new Date(2025, 1, 3); // February 3, 2025
const exemptedUsers = []; // Add emails for exempted users
const testRun = true; // Set to true for testing without applying changes
const preserveEventsWithExemptedAttendees = true; // Preserve events with exempted attendees if true
const restartFromBeginning = false; // Set to true to restart from the beginning

function readAndCancelEvents() {
  const allUsers = getAllUsers();
  const companyDomains = extractUniqueDomains(allUsers);
  console.log(`Company domains: ${companyDomains.join(', ')}`);

  const scriptProps = PropertiesService.getScriptProperties();

  if (restartFromBeginning) {
    scriptProps.deleteProperty('LAST_PROCESSED_EMAIL');
    console.log('Reset requested. Deleted LAST_PROCESSED_EMAIL from PropertiesService.');
  }

  let lastProcessedEmail = scriptProps.getProperty('LAST_PROCESSED_EMAIL') || '';
  console.log(`Resuming from last processed email = "${lastProcessedEmail}"`);

  const sortedUsers = allUsers.slice().sort((a, b) => a.localeCompare(b));
  console.log(`Total users found: ${sortedUsers.length}`);

  const remainingUsers = sortedUsers.filter(email => email > lastProcessedEmail);
  console.log(`Remaining users found: ${remainingUsers.length}`);

  const totalUsers = remainingUsers.length;
  let processedCount = 0;

  for (const userEmail of remainingUsers) {
      processUserCalendar(userEmail, companyDomains);
      scriptProps.setProperty('LAST_PROCESSED_EMAIL', userEmail);
      processedCount++;
      console.log(`Processed ${processedCount} of ${totalUsers} emails. Remaining: ${totalUsers - processedCount}`);
  }
}

function processUserCalendar(userEmail, companyDomains) {
  if (exemptedUsers.includes(userEmail)) {
    console.log(`Skipping exempted user: ${userEmail}`);
    return;
  }

  console.info(`Processing calendar for: ${userEmail}`);
  try {
    const events = fetchCalendarEvents(userEmail);
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
    users.push(...(response.users || []).map(user => user.primaryEmail));
    pageToken = response.nextPageToken;
  } while (pageToken);
  return users;
}

function extractUniqueDomains(users) {
  let userDomains = [...new Set(users.map(email => email.split('@')[1].toLowerCase()))];
  userDomains.push("resource.calendar.google.com");
  return userDomains;
}

function fetchCalendarEvents(userEmail) {
  return (
    Calendar.Events.list(userEmail, {
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
  const organizerEmail = event.organizer?.email || event.creator?.email;
  const isRecurring = !!event.recurrence;

  // Check if there's any attendee outside our domains
  const isExternal = event.attendees?.some(attendee =>
    !companyDomains.some(domain => attendee.email.toLowerCase().endsWith(domain))
  );

  if (isExternal) {
    return isRecurring ? "External/Recurring" : "External/One-Time";
  }

  // Check for exempted user scenarios when the organizer is exempted
  if (exemptedUsers.includes(organizerEmail)) {
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
  // Basic checks for personal or external events
  const organizerEmail = event.organizer?.email || event.creator?.email;

  const isPersonal =
    !event.attendees ||
    event.attendees.every(att => att.email === organizerEmail);

  // If external attendees exist, preserve
  const isExternal = event.attendees?.some(attendee =>
    !companyDomains.some(domain => attendee.email.toLowerCase().endsWith(domain))
  );

  if (isExternal || isPersonal) {
    return false;
  }

  // If the event is authored by an exempted user, always preserve
  if (exemptedUsers.includes(organizerEmail)) {
    return false;
  }

  // If there is at least one exempted user in attendees,
  // and the global flag says "preserve" => do not cancel.
  const hasExemptedAttendee = event.attendees?.some(attendee =>
    exemptedUsers.includes(attendee.email)
  );

  return !(hasExemptedAttendee && preserveEventsWithExemptedAttendees);
}

function updateRecurringEvent(event, userEmail, scenario) {
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

      Calendar.Events.update(updatedEvent, userEmail, event.id);
      console.log(`Updated recurring event to end by ${fromDate.toISOString()}: ${event.summary}, Scenario: ${scenario}`);
    }
  } catch (error) {
    console.error(`Failed to update recurring event: ${error.message}`);
  }
}

function removeEvent(event, userEmail, scenario) {
  try {
    logEventDetails(`${scenario} event to be removed`, event, scenario);

    if (!testRun) {
      Calendar.Events.remove(userEmail, event.id);
      console.log(`Removed ${scenario} event: ${event.summary}, Scenario: ${scenario}`);
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