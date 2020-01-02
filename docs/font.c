#include <stddef.h>

#include <hb.h>

#include "RanaKufi.c"

static hb_font_t* font = NULL;
static hb_face_t* face = NULL;

__attribute__((used))
hb_font_t*
get_font(int dpr)
{
  if (font == NULL)
  {
    if (face == NULL) {
      hb_blob_t* blob = hb_blob_create(RanaKufi, RanaKufi_len,
		                       HB_MEMORY_MODE_READONLY, NULL, NULL);
      face = hb_face_create(blob, 0);
      hb_blob_destroy(blob);
    }

    font = hb_font_create(face);

    int scale = hb_face_get_upem(face) * dpr;
    hb_font_set_scale(font, scale, scale);
  }

  return font;
}
