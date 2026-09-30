import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button-variants";
import { inputClasses } from "@/components/ui/styles";
import { publicAssetUrl } from "@/lib/assets";
import type { ActionResult } from "@/server/admin/common";
import { PUBLIC_UPLOAD_MAX_BYTES } from "@/server/admin/public-images";

import { ActionForm } from "./action-form";
import { Field } from "./ui";

/**
 * Preview + upload + remove for one public image (category icon, slide).
 * The actions validate, re-encode and swap the file on the server.
 */
export async function ImageEditor({
  path,
  upload,
  remove,
  idName,
  id,
  label,
  hint,
  testId,
  previewClassName = "max-h-40 w-auto",
  canRemove = true,
}: {
  path: string | null;
  upload: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
  idName: string;
  id: string;
  label: string;
  hint?: string;
  testId: string;
  previewClassName?: string;
  canRemove?: boolean;
}) {
  const t = await getTranslations("Admin");
  const inputId = `${testId}-${id}-file`;
  return (
    <div className="grid gap-3" data-testid={testId}>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicAssetUrl(path)}
          alt=""
          className={`${previewClassName} justify-self-start rounded-lg border object-contain`}
          data-testid={`${testId}-preview`}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("catalog.noImage")}</p>
      )}
      <ActionForm
        action={upload}
        resetOnSuccess
        successMessage={t("catalog.imageSaved")}
      >
        <input type="hidden" name={idName} value={id} />
        <Field label={label} htmlFor={inputId} hint={hint}>
          <input
            id={inputId}
            name="file"
            type="file"
            data-max-bytes={PUBLIC_UPLOAD_MAX_BYTES}
            accept="image/jpeg,image/png,image/webp"
            required
            className={inputClasses}
          />
        </Field>
        <button
          type="submit"
          className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}
        >
          {t("catalog.uploadImage")}
        </button>
      </ActionForm>
      {path && canRemove && (
        <ActionForm
          action={remove}
          confirmMessage={t("catalog.removeImageConfirm")}
        >
          <input type="hidden" name={idName} value={id} />
          <button
            type="submit"
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-self-start text-destructive`}
          >
            {t("catalog.removeImage")}
          </button>
        </ActionForm>
      )}
    </div>
  );
}
