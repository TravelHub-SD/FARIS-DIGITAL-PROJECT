import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/admin/action-form";
import { ArchiveForm, ProductForm } from "@/components/admin/catalog-forms";
import {
  Badge,
  Empty,
  Field,
  PageHeader,
  Section,
  STATE_TONE,
  stateOf,
  TableWrap,
} from "@/components/admin/ui";
import { L10n } from "@/components/catalog/l10n";
import { Link } from "@/components/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import type { Locale } from "@/i18n/routing";
import { publicAssetUrl } from "@/lib/assets";
import { formatSdg, formatUsd } from "@/lib/format";
import { localized } from "@/lib/localized";
import { removeProductImage, uploadProductImage } from "@/server/admin/catalog";
import {
  getAdminProduct,
  getRate,
  listAdminCategories,
} from "@/server/admin/catalog-queries";
import { requireAdmin } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false } };

export default async function EditProductPage({
  params,
}: PageProps<"/[locale]/admin/catalog/products/[id]">) {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  await requireAdmin(locale, "products");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations("Admin");
  const [product, categories, rate] = await Promise.all([
    getAdminProduct(id),
    listAdminCategories(),
    getRate(),
  ]);
  if (!product) notFound();
  const state = stateOf(product);
  const options = categories.map((c) => ({
    id: c.id,
    name: localized(c.name_ar, c.name_en, locale)?.text ?? c.slug,
  }));

  return (
    <>
      <Link
        href="/admin/catalog"
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("catalog.back")}
      </Link>
      <PageHeader
        title={
          <L10n value={localized(product.name_ar, product.name_en, locale)} />
        }
        actions={
          <>
            <Badge tone={STATE_TONE[state]}>
              {t(`catalog.states.${state}`)}
            </Badge>
            {state === "active" && (
              <Link
                href={`/p/${product.slug}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                target="_blank"
              >
                {t("catalog.viewOnSite")}
              </Link>
            )}
          </>
        }
      />

      <Section title={t("catalog.details")}>
        <ProductForm product={product} categories={options} />
      </Section>

      <Section
        title={t("catalog.image")}
        description={t("catalog.imageHint")}
        testId="product-image"
      >
        {product.image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={publicAssetUrl(product.image_path)}
            alt=""
            className="max-h-64 w-auto justify-self-start rounded-lg border object-contain"
            data-testid="product-image-preview"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("catalog.noImage")}
          </p>
        )}
        <ActionForm
          action={uploadProductImage}
          resetOnSuccess
          testId="upload-image"
          successMessage={t("catalog.imageSaved")}
        >
          <input type="hidden" name="productId" value={product.id} />
          <Field label={t("catalog.chooseImage")} htmlFor="file">
            <input
              id="file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              className={inputClasses}
            />
          </Field>
          <button
            type="submit"
            className={`${buttonVariants({ variant: "outline" })} justify-self-start`}
          >
            {t("catalog.uploadImage")}
          </button>
        </ActionForm>
        {product.image_path && (
          <ActionForm
            action={removeProductImage}
            confirmMessage={t("catalog.removeImageConfirm")}
            testId="remove-image"
          >
            <input type="hidden" name="productId" value={product.id} />
            <button
              type="submit"
              className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-self-start text-destructive`}
            >
              {t("catalog.removeImage")}
            </button>
          </ActionForm>
        )}
      </Section>

      <Section
        title={t("catalog.variants")}
        description={t("catalog.variantsHint")}
        actions={
          <Link
            href={`/admin/catalog/products/${product.id}/variants/new`}
            className={buttonVariants({ size: "sm" })}
          >
            {t("catalog.newVariant")}
          </Link>
        }
      >
        {product.variants.length === 0 ? (
          <Empty>{t("catalog.noVariantsYet")}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>{t("catalog.variantName")}</th>
                <th>{t("catalog.priceUsd")}</th>
                <th>{t("catalog.priceSdgNow")}</th>
                <th>{t("catalog.maxQuantity")}</th>
                <th>{t("catalog.requiredFields")}</th>
                <th>{t("catalog.state")}</th>
              </tr>
            </thead>
            <tbody data-testid="admin-variants">
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link
                      href={`/admin/catalog/variants/${v.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      <L10n value={localized(v.name_ar, v.name_en, locale)} />
                    </Link>
                  </td>
                  <td dir="auto">{formatUsd(v.price_usd, locale)}</td>
                  <td dir="auto">
                    {rate
                      ? formatSdg(Math.ceil(v.price_usd * rate), locale)
                      : "—"}
                  </td>
                  <td>{v.max_quantity}</td>
                  <td>{v.required_fields.length}</td>
                  <td>
                    <Badge tone={STATE_TONE[stateOf(v)]}>
                      {t(`catalog.states.${stateOf(v)}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="text-xs text-muted-foreground">
          {t("catalog.sdgPreviewNote")}
        </p>
      </Section>

      <Section title={t("catalog.archiveTitle")}>
        <ArchiveForm
          kind="product"
          id={product.id}
          archived={!!product.archived_at}
        />
      </Section>
    </>
  );
}
