const fromDate = new Date(2025, 1, 3); // February 3, 2025
const exemptedUsers = []; // Add emails for exempted users
const testRun = true; // Set to true for testing without applying changes

function readAndCancelEvents() {
  const users = getAllUsers();

  const domains = [];
  users.forEach(email => {
    const domain = email.split('@')[1].toLowerCase(); // Ensure case insensitivity
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }
  });

  console.log(`Company domains: ${domains.join(', ')}`);
  console.log(`Processing ${users.length} users.`);

  users.forEach(userEmail => {
    if (exemptedUsers.includes(userEmail)) {
      console.log(`Skipping exempted user: ${userEmail}`);
      return;
    }

    console.info(`Processing calendar for: ${userEmail}`);
    try {
      const events = Calendar.Events.list(userEmail, {
        timeMin: fromDate.toISOString(),
        maxResults: 10000,
        singleEvents: false,
      }).items;

      console.log(`Found ${events.length} events in ${userEmail}'s calendar.`);

      const masterEvents = events.filter(event => !event.recurringEventId);

      masterEvents.forEach(event => {
        const scenario = classifyEvent(event, domains);

        if (scenario === "Internal/Recurring" || scenario === "Internal/One-Time") {
          if (shouldCancelEvent(event, domains)) {
            console.log(`Cancelling event: ${event.summary}, Scenario: ${scenario}`);
            if (scenario === "Internal/Recurring") {
              updateRecurringEvent(event, userEmail, testRun, scenario);
            } else {
              removeOneTimeEvent(event, userEmail, testRun, scenario);
            }
          }
        } else {
          console.log(`Preserving event: ${event.summary}, Scenario: ${scenario}`);
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

function classifyEvent(event, domains) {
  const organizerEmail = event.organizer?.email || event.creator?.email;
  const isRecurring = !!event.recurrence;
  const isExternal = event.attendees?.some(attendee => !domains.some(domain => attendee.email.toLowerCase().endsWith(domain)));

  if (isExternal) return isRecurring ? "External/Recurring" : "External/One-Time";
  if (!event.attendees || event.attendees.length === 0 || event.attendees.every(att => att.email === organizerEmail)) return "Personal";
  return isRecurring ? "Internal/Recurring" : "Internal/One-Time";
}

function shouldCancelEvent(event, domains) {
  const organizerEmail = event.organizer?.email || event.creator?.email;
  const isPersonal = !event.attendees || event.attendees.every(att => att.email === organizerEmail);
  const isExternal = event.attendees?.some(attendee => !domains.some(domain => attendee.email.toLowerCase().endsWith(domain)));

  // Preserve external and personal events
  if (isExternal || isPersonal) return false;

  return true; // Cancel internal events
}

function updateRecurringEvent(event, userEmail, testRun, scenario) {
  try {
    const updatedRecurrence = event.recurrence.map(rule => {
      if (rule.startsWith("RRULE:")) {
        const parts = rule.split(";");
        const updatedParts = parts.filter(part => !part.startsWith("UNTIL="));
        updatedParts.push(`UNTIL=${fromDate.toISOString().split("T")[0].replace(/-/g, "")}`);
        return updatedParts.join(";");
      }
      return rule;
    });

    console.log(`Recurring event is to be updated: ${event.summary}
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
    console.log(`One-time event is to be removed: ${event.summary}, Scenario: ${scenario}`);
    if (!testRun) {
      Calendar.Events.remove(userEmail, event.id);
      console.log(`Removed one-time event: ${event.summary}}, Scenario: ${scenario}`);
    }
  } catch (e) {
    console.error(`Failed to remove one-time event: ${e.message}`);
  }
}