import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getMeeting, canManageMeeting } from "@/lib/huddles";
import { assignablePeople } from "@/lib/groundwork";
import { isCalendarConfigured } from "@/lib/google-calendar";
import { huddleGoogleCalendarUrl } from "@/lib/huddle-ics";
import HuddleRun from "./HuddleRun";

export const dynamic = "force-dynamic";

// The Huddle run view: the live agenda (check items off), live notes (a running
// log), attendees, and real-time follow-ups (assigned to an attendee with a due
// date — they immediately appear under that person's My Work). Calendar sync is
// shown honestly: live Google sync when configured, otherwise an .ics / Google
// "add to calendar" fallback.
export default async function HuddleRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [meeting, people] = await Promise.all([getMeeting(user, id), assignablePeople(user)]);
  if (!meeting) notFound();

  const canManage = canManageMeeting(user, { organizerId: meeting.organizerId });
  const calendarLive = isCalendarConfigured();

  // Fallback "add to calendar" — only when there's a scheduled time and sync is off.
  let googleUrl: string | null = null;
  if (!calendarLive && meeting.scheduledStart && meeting.scheduledEnd) {
    googleUrl = huddleGoogleCalendarUrl({
      id: meeting.id,
      title: meeting.title,
      description: meeting.kind ? `${meeting.kind} Huddle` : null,
      start: new Date(meeting.scheduledStart),
      end: new Date(meeting.scheduledEnd),
      location: meeting.location,
      meetingLink: meeting.meetingLink,
    });
  }

  return (
    <HuddleRun
      initialMeeting={meeting}
      people={people}
      meId={user.id}
      canManage={canManage}
      calendarLive={calendarLive}
      googleUrl={googleUrl}
    />
  );
}
