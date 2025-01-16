const fromDate = new Date(2025, 1, 3); // February 3, 2025
const exemptedUsers = []; // Add emails for exempted users
const testRun = true; // Set to true for testing without applying changes
const preserveEventsWithExemptedAttendees = true; // Controls whether to preserve or remove events that include at least one user from exemptedUsers.

function readAndCancelEvents() {
  const users = getAllUsers();

  const domains = extractUniqueDomains(users);
  console.log(`Company domains: ${domains.join(', ')}`);
  console.log(`Processing ${users.length} users.`);

  users.forEach(userEmail => {
    if (exemptedUsers.includes(userEmail)) {
      console.log(`Skipping exempted user: ${userEmail}`);
      return;
    }

    console.info(`Processing calendar for: ${userEmail}`);
    try {
      const events = fetchCalendarEvents(userEmail);

      console.log(`Found ${events.length} events in ${userEmail}'s calendar.`);

      // Filter out recurring "child" instances (we only want to modify the "master" events)
      const masterEvents = events.filter(event => !event.recurringEventId);

      masterEvents.forEach(event => {
        const scenario = classifyEvent(event, domains);

        if (scenario === "Internal/Recurring" || scenario === "Internal/One-Time" || scenario.startsWith("Exempted")) {
          if (shouldCancelEvent(event, domains, preserveEventsWithExemptedAttendees)) {            
            if (scenario === "Internal/Recurring") {
              updateRecurringEvent(event, userEmail, testRun, scenario);
            } else {
              removeOneTimeEvent(event, userEmail, testRun, scenario);
            }
          } else {
            console.log(`Preserving event: ${event.summary}, Scenario: ${scenario}
              Summary: ${event.summary}
              Start: ${event.start?.dateTime || event.start?.date}
              End: ${event.end?.dateTime || event.end?.date}
              Author/Creator: ${event.organizer?.email || event.creator?.email}
              Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}`);
          }
        } else {
          console.log(`Preserving event: ${event.summary}, Scenario: ${scenario}
            Summary: ${event.summary}
            Start: ${event.start?.dateTime || event.start?.date}
            End: ${event.end?.dateTime || event.end?.date}
            Author/Creator: ${event.organizer?.email || event.creator?.email}
            Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}`);
        }
      });
    } catch (e) {
      console.error(`Failed to process calendar for ${userEmail}: ${e.message}`);
    }
  });
}

function getAllUsers() {
  const users = [];
  let pageToken;

  do {
    const response = AdminDirectory.Users.list({
      customer: 'my_customer',
      maxResults: 500,
      pageToken: pageToken,
    });
    const userList = response.users || [];
    users.push(...userList.map(user => user.primaryEmail));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return users;
}

function extractUniqueDomains(users) {
  const domains = [];
  users.forEach(email => {
    const domain = email.split('@')[1].toLowerCase(); // Ensure case insensitivity
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }
  });
  return domains;
}

function fetchCalendarEvents(userEmail) {
  const response = Calendar.Events.list(userEmail, {
    timeMin: fromDate.toISOString(),
    maxResults: 10000,
    singleEvents: false,
  });
  return response.items || [];
}

/**
 * Classifies an event into a scenario:
 * - External/Recurring or External/One-Time
 * - Internal/Recurring or Internal/One-Time
 * - Exempted/AsAuthor or Exempted/AsAttendee
 * - Personal (no other attendees or only organizer as attendee)
 */
function classifyEvent(event, domains) {
  const organizerEmail = event.organizer?.email || event.creator?.email;
  const isRecurring = !!event.recurrence;

  // Check if there's any attendee outside our domains
  const isExternal = event.attendees?.some(attendee =>
    !domains.some(domain => attendee.email.toLowerCase().endsWith(domain))
  );

  if (isExternal) {
    return isRecurring ? "External/Recurring" : "External/One-Time";
  }

  // Check for exempted user scenarios
  if (exemptedUsers.includes(organizerEmail)) {
    return isRecurring ? "Exempted/AsAuthor" : "Exempted/AsAuthor";
  }

  if (event.attendees?.some(attendee => exemptedUsers.includes(attendee.email))) {
    return isRecurring ? "Exempted/AsAttendee" : "Exempted/AsAttendee";
  }

  // If no attendees (other than possibly the organizer), treat as personal
  if (
    !event.attendees ||
    event.attendees.length === 0 ||
    event.attendees.every(att => att.email === organizerEmail)
  ) {
    return "Personal";
  }

  return isRecurring ? "Internal/Recurring" : "Internal/One-Time";
}

/**
 * Determines whether we should cancel (delete/modify) the given event,
 * applying our extra rule about exempted users in the attendee list.
 */
function shouldCancelEvent(event, domains, preserveEventsWithExemptedAttendees) {
  // Basic checks for personal or external events
  const organizerEmail = event.organizer?.email || event.creator?.email;
  
  const isPersonal =
    !event.attendees ||
    event.attendees.every(att => att.email === organizerEmail);

  // If external attendees exist, preserve
  const isExternal = event.attendees?.some(attendee =>
    !domains.some(domain => attendee.email.toLowerCase().endsWith(domain))
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

  if (hasExemptedAttendee && preserveEventsWithExemptedAttendees) {
    return false;
  }

  // Otherwise, remove (cancel) the event
  return true;
}

function updateRecurringEvent(event, userEmail, testRun, scenario) {
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

    console.log(`Recurring event is to be updated: ${event.summary}, Scenario: ${scenario}
      Start Date: ${event.start?.dateTime || event.start?.date}
      End Date: ${event.end?.dateTime || event.end?.date}
      Author/Creator: ${event.organizer?.email || event.creator?.email}
      Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}
      Old Recurrence: ${event.recurrence}
      New Recurrence: ${updatedRecurrence}`);

    if (!testRun) {
      const updatedEvent = {
        ...event,
        recurrence: updatedRecurrence
      };

      Calendar.Events.update(updatedEvent, userEmail, event.id);
      console.log(`Updated recurring event to end by ${fromDate.toISOString()}: ${event.summary}, Scenario: ${scenario}`);
    }
  } catch (e) {
    console.error(`Failed to update recurring event: ${e.message}`);
  }
}

function removeOneTimeEvent(event, userEmail, testRun, scenario) {
  try {
    console.log(`One-time event is to be removed: ${event.summary}, Scenario: ${scenario}
      Start Date: ${event.start?.dateTime || event.start?.date}
      End Date: ${event.end?.dateTime || event.end?.date}
      Author/Creator: ${event.organizer?.email || event.creator?.email}
      Attendees: ${event.attendees?.map(a => a.email).join(', ') || 'None'}`);
    if (!testRun) {
      Calendar.Events.remove(userEmail, event.id);
      console.log(`Removed one-time event: ${event.summary}, Scenario: ${scenario}`);
    }
  } catch (e) {
    console.error(`Failed to remove one-time event: ${e.message}`);
  }
}