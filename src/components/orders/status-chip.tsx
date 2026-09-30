import { getTranslations } from "next-intl/server";

import type { OrderStatus } from "@/server/orders/queries";

const TONES: Record<OrderStatus | "review", string> = {
  new: "bg-warning-soft text-warning-text",
  review: "bg-primary-soft text-primary-text",
  processing: "bg-primary-soft text-primary-text",
  completed: "bg-success-soft text-success-text",
  cancelled: "bg-muted text-muted-foreground",
};

/** "Awaiting payment" becomes "Payment under review" once a receipt is sent. */
export async function StatusChip({
  status,
  inReview = false,
  testId,
}: {
  status: OrderStatus;
  inReview?: boolean;
  testId?: string;
}) {
  const t = await getTranslations("Orders");
  const review = status === "new" && inReview;
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-bold ${TONES[review ? "review" : status]}`}
      data-testid={testId}
      data-status={status}
    >
      {review ? t("paymentReview") : t(`statuses.${status}`)}
    </span>
  );
}
