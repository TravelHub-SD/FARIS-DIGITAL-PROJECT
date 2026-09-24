import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  Badge,
  Empty,
  PageHeader,
  Section,
  STATE_TONE,
  stateOf,
  TableWrap,
} from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses, selectClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { publicAssetUrl, thumbPath } from "@/lib/assets";
import { formatUsd } from "@/lib/format";
import { localized } from "@/lib/localized";
import {
  listAdminCategories,
  listAdminProducts,
} from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

const STATES = ["active", "hidden", "archived"] as const;

export default async function CatalogPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/catalog">) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : undefined;
  const category =
    typeof sp.category === "string" && /^[0-9a-f-]{36}$/.test(sp.category)
      ? sp.category
      : undefined;
  const state = STATES.find((s) => s === sp.state);
  const t = await getTranslations("Admin");
  const [categories, products] = await Promise.all([
    listAdminCategories(),
    listAdminProducts({ q, category, state }),
  ]);

  return (
    <>
      <PageHeader title={t("catalog.title")} description={t("catalog.intro")} />

      <Section
        title={t("catalog.categories")}
        actions={
          <Link
            href="/admin/catalog/categories/new"
            className={buttonVariants({ size: "sm" })}
          >
            {t("catalog.newCategory")}
          </Link>
        }
      >
        {categories.length === 0 ? (
          <Empty>{t("catalog.noCategories")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{t("catalog.name")}</th>
                <th>{t("catalog.slug")}</th>
                <th>{t("catalog.products")}</th>
                <th>{t("catalog.state")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-categories">
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`/admin/catalog/categories/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      <L10n value={localized(c.name_ar, c.name_en, locale)} />
                    </Link>
                  </td>
                  <td dir="ltr" className="text-muted-foreground">
                    {c.slug}
                  </td>
                  <td>{c.product_count}</td>
                  <td>
                    <Badge tone={STATE_TONE[stateOf(c)]}>
                      {t(`catalog.states.${stateOf(c)}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section
        title={t("catalog.products")}
        actions={
          <Link
            href="/admin/catalog/products/new"
            className={buttonVariants({ size: "sm" })}
          >
            {t("catalog.newProduct")}
          </Link>
        }
      >
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-[1fr_12rem_10rem_auto]"
          role="search"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder={t("catalog.searchPlaceholder")}
            aria-label={t("catalog.search")}
            className={inputClasses}
          />
          <select
            name="category"
            defaultValue={category ?? ""}
            aria-label={t("catalog.category")}
            className={selectClasses}
          >
            <option value="">{t("catalog.allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {localized(c.name_ar, c.name_en, locale)?.text ?? c.slug}
              </option>
            ))}
          </select>
          <select
            name="state"
            defaultValue={state ?? ""}
            aria-label={t("catalog.state")}
            className={selectClasses}
          >
            <option value="">{t("catalog.anyState")}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {t(`catalog.states.${s}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={buttonVariants({ variant: "outline" })}
          >
            {t("filter")}
          </button>
        </form>
        {products.length === 0 ? (
          <Empty>{t("catalog.noProducts")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className="w-16">{t("catalog.image")}</th>
                <th>{t("catalog.name")}</th>
                <th>{t("catalog.category")}</th>
                <th>{t("catalog.fromPrice")}</th>
                <th>{t("catalog.completedOrders")}</th>
                <th>{t("catalog.state")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-products">
              {products.map((p) => {
                const live = p.variants.filter(
                  (v) => v.is_active && !v.archived_at,
                );
                const min = live.length
                  ? Math.min(...live.map((v) => Number(v.price_usd)))
                  : null;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.image_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={publicAssetUrl(thumbPath(p.image_path))}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          className="size-12 rounded-md border object-cover"
                        />
                      ) : (
                        <span className="flex size-12 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/admin/catalog/products/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        <L10n value={localized(p.name_ar, p.name_en, locale)} />
                      </Link>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {p.slug}
                      </div>
                    </td>
                    <td>
                      <L10n
                        value={localized(
                          p.category?.name_ar,
                          p.category?.name_en,
                          locale,
                        )}
                      />
                    </td>
                    <td dir="auto">
                      {min !== null ? (
                        formatUsd(min, locale)
                      ) : (
                        <span className="text-muted-foreground">
                          {t("catalog.noVariants")}
                        </span>
                      )}
                    </td>
                    <td>{p.completed_orders_count}</td>
                    <td>
                      <Badge tone={STATE_TONE[stateOf(p)]}>
                        {t(`catalog.states.${stateOf(p)}`)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
