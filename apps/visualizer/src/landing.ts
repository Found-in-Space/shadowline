type EclipseKind = "total" | "annular" | "hybrid" | "partial";

interface CountdownEvent {
  id: string;
  kind: EclipseKind;
  startUtc: string;
  endUtc: string;
}

interface CountdownWorkerResponse {
  event?: CountdownEvent;
  error?: string;
}

const INITIAL_EVENT: CountdownEvent = {
  id: "solar-2026-08-12-total",
  kind: "total",
  startUtc: "2026-08-12T15:34:05.639Z",
  endUtc: "2026-08-12T19:57:49.425Z",
};

const countdownCard = document.getElementById("eclipse-countdown");
const countdownKicker = document.getElementById("eclipse-countdown-kicker");
const countdownValue = document.getElementById(
  "eclipse-countdown-value",
) as HTMLTimeElement | null;
const countdownDetail = document.getElementById("eclipse-countdown-detail");

let countdownEvent: CountdownEvent | null =
  Date.now() <= Date.parse(INITIAL_EVENT.endUtc) ? INITIAL_EVENT : null;
let followingEvent: CountdownEvent | null = null;
let searchTarget: "active" | "following" | null = null;

function countdownText(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

function eventDate(utc: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(utc));
}

function eventTime(utc: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(utc));
}

function searchForNextEclipse(target: "active" | "following"): void {
  if (searchTarget) return;
  searchTarget = target;
  const eventAtRequest = countdownEvent;
  const atUtc = target === "following" && eventAtRequest
    ? new Date(Date.parse(eventAtRequest.endUtc) + 1).toISOString()
    : new Date().toISOString();

  const worker = new Worker(new URL("./landing-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener(
    "message",
    (message: MessageEvent<CountdownWorkerResponse>) => {
      const completedTarget = searchTarget;
      searchTarget = null;
      if (message.data.event) {
        if (
          completedTarget === "following" &&
          countdownEvent?.id === eventAtRequest?.id
        ) {
          followingEvent = message.data.event;
        } else {
          countdownEvent = message.data.event;
        }
        renderCountdown();
      } else if (countdownDetail) {
        countdownDetail.textContent =
          "The next eclipse could not be calculated. Please reload to try again.";
      }
      worker.terminate();
    },
  );
  worker.addEventListener("error", () => {
    searchTarget = null;
    if (countdownDetail) {
      countdownDetail.textContent =
        "The next eclipse could not be calculated. Please reload to try again.";
    }
    worker.terminate();
  });
  worker.postMessage({
    atUtc,
    afterEventId: target === "following" ? eventAtRequest?.id : undefined,
  });
}

function primeFollowingEclipse(): void {
  if (countdownEvent && !followingEvent && !searchTarget) {
    searchForNextEclipse("following");
  }
}

function renderCountdown(): void {
  if (
    !countdownCard ||
    !countdownKicker ||
    !countdownValue ||
    !countdownDetail
  ) {
    return;
  }

  const now = Date.now();
  if (countdownEvent && now > Date.parse(countdownEvent.endUtc)) {
    countdownEvent = followingEvent;
    followingEvent = null;
  }

  if (!countdownEvent) {
    countdownEvent = null;
    countdownCard.dataset.state = "loading";
    countdownKicker.textContent = "Next solar eclipse";
    countdownValue.textContent = "Calculating…";
    countdownValue.removeAttribute("datetime");
    countdownDetail.textContent =
      "Finding when the Moon’s shadow next touches Earth.";
    searchForNextEclipse("active");
    return;
  }

  const start = Date.parse(countdownEvent.startUtc);
  const end = Date.parse(countdownEvent.endUtc);
  if (now < start) {
    countdownCard.dataset.state = "upcoming";
    countdownKicker.textContent = "Next eclipse begins in";
    countdownValue.textContent = countdownText(start - now);
    countdownValue.dateTime = countdownEvent.startUtc;
    countdownDetail.textContent =
      `First shadow touches Earth · ${eventDate(countdownEvent.startUtc)} · ${eventTime(countdownEvent.startUtc)} UTC`;
    primeFollowingEclipse();
    return;
  }

  countdownCard.dataset.state = "live";
  countdownKicker.textContent = "Eclipse in progress";
  countdownValue.textContent = "Now!";
  countdownValue.dateTime = countdownEvent.endUtc;
  countdownDetail.textContent =
    `The Moon’s shadow is crossing Earth · until ${eventTime(countdownEvent.endUtc)} UTC`;
  primeFollowingEclipse();
}

renderCountdown();
window.setInterval(renderCountdown, 1_000);
