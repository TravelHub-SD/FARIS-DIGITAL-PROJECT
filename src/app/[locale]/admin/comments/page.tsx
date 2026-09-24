import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import {
  Badge,
  Empty,
  PageHeader,
  Pagination,
  Section,
  withQuery,
} from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/format";
import { localized } from "@/lib/localized";
import { moderateComment } from "@/server/admin/people";
import { listComments } from "@/server/admin/people-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function CommentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/comments">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "comments");
  const sp = await searchParams;
  const status =
    sp.status === "visible" || sp.status === "hidden" ? sp.status : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const page =
    typeof sp.page === "string" && /^\d{1,5}$/.test(sp.page)
      ? Number(sp.page)
      : 1;
  const t = await getTranslations("Admin");
  const result = await listComments({ status, q, page });

  return (
    <>
      <PageHeader
        title={t("comments.title")}
        description={t("comments.intro")}
      />
      <Section>
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]"
          role="search"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder={t("comments.searchPlaceholder")}
            aria-label={t("comments.search")}
            className={inputClasses}
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label={t("comments.status")}
            className={selectClasses}
          >
            <option value="">{t("comments.all")}</option>
            <option value="visible">{t("comments.visible")}</option>
            <option value="hidden">{t("comments.hidden")}</option>
          </select>
          <button
            type="submit"
            className={buttonVariants({ variant: "outline" })}
          >
            {t("filter")}
          </button>
        </form>
        {result.rows.length === 0 ? (
          <Empty>{t("comments.none")}</Empty>
        ) : (
          <ul className="grid gap-3" data-testid="admin-comments">
            {result.rows.map((c) => (
              <li
                key={c.id}
                className="grid gap-3 rounded-lg border p-3"
                data-comment-status={c.status}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {c.author ?? t("customers.noName")}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <Link
                    href={`/p/${c.product_slug}`}
                    className="text-primary hover:underline"
                    target="_blank"
                  >
                    <L10n
                      value={localized(
                        c.product_name_ar,
                        c.product_name_en,
                        locale,
                      )}
                    />
                  </Link>
                  <span className="text-muted-foreground">
                    · {formatDateTime(c.created_at, locale)}
                  </span>
                  {c.status === "hidden" && (
                    <Badge tone="warning">{t("comments.hidden")}</Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {c.body}
                </p>
                {c.hidden_reason && (
                  <p className="text-xs text-muted-foreground">
                    {t("comments.reason")}: {c.hidden_reason}
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-3">
                  {c.status === "visible" ? (
                    <ActionForm
                      action={moderateComment}
                      className="flex flex-wrap items-end gap-2"
                      testId="hide-comment"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="action" value="hide" />
                      <input
                        name="reason"
                        maxLength={300}
                        placeholder={t("comments.reasonPlaceholder")}
                        aria-label={t("comments.reason")}
                        className={`${inputClasses} w-56`}
                      />
                      <button
                        type="submit"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        {t("comments.hide")}
                      </button>
                    </ActionForm>
                  ) : (
                    <ActionForm action={moderateComment} testId="show-comment">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="action" value="show" />
                      <button
                        type="submit"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        {t("comments.show")}
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm
                    action={moderateComment}
                    confirmMessage={t("comments.deleteConfirm")}
                    testId="delete-comment"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="action" value="delete" />
                    <button
                      type="submit"
                      className={
                        buttonVariants({ variant: "ghost", size: "sm" }) +
                        " text-destructive"
                      }
                    >
                      {t("comments.delete")}
                    </button>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={result.page}
          pages={result.pages}
          href={(p) => withQuery("/admin/comments", { status, q, page: p })}
          labels={{
            previous: t("previous"),
            next: t("next"),
            page: t("page", { page: result.page, pages: result.pages }),
          }}
        />
      </Section>
    </>
  );
}
