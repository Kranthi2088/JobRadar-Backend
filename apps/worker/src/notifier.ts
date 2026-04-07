import { Worker } from "bullmq";
import webpush from "web-push";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  DASHBOARD_VISIBILITY_WINDOW_MS,
  QUEUE_NAMES,
  isUnitedStatesJobLocationOrTitle,
  jobMatchesWatchlist,
} from "@jobradar/shared";
import { createRedisConnection } from "./redis";

type WatchlistWithUser = Prisma.WatchlistGetPayload<{
  include: {
    user: {
      include: {
        pushSubscriptions: true;
        preferences: true;
      };
    };
  };
}>;
import type { Logger } from "pino";
import type { NormalizedJob } from "@jobradar/shared";
import { computeListingKey } from "@jobradar/ats-adapters";

interface NewJobData {
  companySlug: string;
  companyId: string;
  job: NormalizedJob & {
    detectedAt: string;
    postedAt?: string;
    listingKey?: string;
  };
}

function isDashboardVisibleJob(job: {
  postedAt?: string;
  detectedAt: string;
  location?: string | null;
  title: string;
}) {
  const ts = Date.parse(job.postedAt ?? job.detectedAt);
  if (Number.isNaN(ts)) return false;
  if (ts < Date.now() - DASHBOARD_VISIBILITY_WINDOW_MS) return false;
  return isUnitedStatesJobLocationOrTitle(job.location, job.title);
}

if (process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export async function startNotifier(logger: Logger) {
  const worker = new Worker<NewJobData>(
    QUEUE_NAMES.NEW_JOBS,
    async (bullJob) => {
      const { companySlug, companyId, job } = bullJob.data;
      if (!isDashboardVisibleJob(job)) {
        return;
      }

      const company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      const listingKey = job.listingKey ?? computeListingKey(job.url);
      const dbJob = await prisma.job.findUnique({
        where: {
          companyId_listingKey: { companyId, listingKey },
        },
      });

      if (!dbJob) {
        logger.warn(
          { companyId, listingKey },
          "Skipping notification — job row missing after persist"
        );
        return;
      }

      const matchingWatchlists = await prisma.watchlist.findMany({
        where: {
          companyId,
        },
        include: {
          user: {
            include: {
              pushSubscriptions: true,
              preferences: true,
            },
          },
        },
      });

      const matchedUsers = matchingWatchlists.filter((wl: WatchlistWithUser) =>
        jobMatchesWatchlist(
          {
            companyId,
            title: job.title,
            location: job.location ?? null,
            seniority: job.seniority ?? null,
          },
          {
            companyId: wl.companyId,
            roleKeyword: wl.roleKeyword,
            locationFilter: wl.locationFilter,
            seniorityFilter: wl.seniorityFilter,
          }
        )
      );

      logger.info({
        jobTitle: job.title,
        company: companySlug,
        matchedUsers: matchedUsers.length,
      }, "Processing notification for new job");

      const notificationPayload = JSON.stringify({
        title: `New role at ${company?.name || companySlug}`,
        body: job.title,
        data: {
          jobId: dbJob.id,
          url: job.url,
          company: company?.name || companySlug,
          detectedAt: job.detectedAt,
          postedAt: job.postedAt,
        },
        icon: company?.logoUrl || "/icon-192.png",
        badge: "/badge-72.png",
      });

      for (const wl of matchedUsers) {
        const { user } = wl;

        if (isInQuietHours(user.preferences)) {
          logger.debug({ userId: user.id }, "Skipping - user in quiet hours");
          continue;
        }

        for (const sub of user.pushSubscriptions) {
          if (sub.type === "web" && sub.endpoint && sub.p256dh && sub.auth) {
            try {
              await webpush.sendNotification(
                {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dh, auth: sub.auth },
                },
                notificationPayload
              );

              await prisma.notification.create({
                data: {
                  userId: user.id,
                  jobId: dbJob.id,
                  channel: "web_push",
                },
              });

              logger.debug({ userId: user.id }, "Web push sent");
            } catch (err: any) {
              if (err.statusCode === 410 || err.statusCode === 404) {
                await prisma.pushSubscription.delete({
                  where: { id: sub.id },
                });
                logger.info({ subId: sub.id }, "Removed expired push subscription");
              } else {
                logger.error({ userId: user.id, err: err.message }, "Web push failed");
              }
            }
          }
        }

        if (
          user.preferences?.emailMode === "instant" &&
          user.email
        ) {
          try {
            await sendEmailNotification(user.email, company?.name || companySlug, job);

            await prisma.notification.create({
              data: {
                userId: user.id,
                jobId: dbJob.id,
                channel: "email",
              },
            });
          } catch (err: any) {
            logger.error({ userId: user.id, err: err.message }, "Email notification failed");
          }
        }

        if (
          user.preferences?.telegramEnabled &&
          user.preferences?.telegramChatId
        ) {
          try {
            await sendTelegramNotification(
              user.preferences.telegramChatId,
              company?.name || companySlug,
              job
            );

            await prisma.notification.create({
              data: {
                userId: user.id,
                jobId: dbJob.id,
                channel: "telegram",
              },
            });
          } catch (err: any) {
            logger.error(
              { userId: user.id, err: err.message },
              "Telegram notification failed"
            );
          }
        }
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Notification job failed");
  });

  worker.on("error", (err) => {
    logger.error({ err: err.message }, "Notification worker error");
  });
}

function isInQuietHours(
  preferences: { quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string } | null
): boolean {
  if (!preferences?.quietHoursStart || !preferences?.quietHoursEnd) return false;

  const now = new Date();
  const [startH, startM] = preferences.quietHoursStart.split(":").map(Number);
  const [endH, endM] = preferences.quietHoursEnd.split(":").map(Number);

  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

async function sendEmailNotification(
  email: string,
  companyName: string,
  job: NormalizedJob & { detectedAt: string; postedAt?: string }
) {
  if (!process.env.RESEND_API_KEY) return;

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const postedLine = job.postedAt
    ? `<p style="color: #666; font-size: 14px; margin-top: 0;">Posted (ATS): ${new Date(job.postedAt).toLocaleString()}</p>`
    : "";

  await resend.emails.send({
    from: "JobRadar <alerts@jobradar.app>",
    to: email,
    subject: `🚀 New role at ${companyName}: ${job.title}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #111; margin-bottom: 4px;">New role detected!</h2>
        ${postedLine}
        <p style="color: #666; font-size: 14px; margin-top: 0;">Found by JobRadar ${new Date(job.detectedAt).toLocaleString()}</p>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin: 16px 0;">
          <h3 style="margin: 0 0 8px; color: #111;">${job.title}</h3>
          <p style="margin: 0 0 4px; color: #555;">${companyName}</p>
          ${job.location ? `<p style="margin: 0 0 4px; color: #888; font-size: 14px;">📍 ${job.location}</p>` : ""}
          ${job.team ? `<p style="margin: 0; color: #888; font-size: 14px;">👥 ${job.team}</p>` : ""}
        </div>
        <a href="${job.url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Apply Now →</a>
      </div>
    `,
  });
}

async function sendTelegramNotification(
  chatId: string,
  companyName: string,
  job: NormalizedJob & { detectedAt: string; postedAt?: string }
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const message =
    `🚀 *New role detected*\n\n` +
    `*${job.title}*\n` +
    `${companyName}\n` +
    `${job.location ? `📍 ${job.location}\n` : ""}` +
    `${job.team ? `👥 ${job.team}\n` : ""}` +
    `🕒 ${new Date(job.detectedAt).toLocaleString()}\n\n` +
    `[Apply now](${job.url})`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}
