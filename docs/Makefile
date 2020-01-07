HBDIR = harfbuzz/src
FONTDIR = ../..

INCLUDES = -I$(HBDIR)

EM_CFLAGS = \
	  --llvm-lto 1 \
	  -s ENVIRONMENT=web \
	  -s FILESYSTEM=0 \
	  -s 'EXTRA_EXPORTED_RUNTIME_METHODS=["stackAlloc"]' \
	  -s 'EXPORTED_FUNCTIONS=[ \
	      "_hb_blob_create", \
	      "_hb_blob_get_data", \
	      "_hb_buffer_add", \
	      "_hb_buffer_clear_contents", \
	      "_hb_buffer_create", \
	      "_hb_buffer_get_glyph_infos", \
	      "_hb_buffer_get_glyph_positions", \
	      "_hb_buffer_get_length", \
	      "_hb_buffer_set_content_type", \
	      "_hb_buffer_set_direction", \
	      "_hb_buffer_set_script", \
	      "_hb_face_create", \
	      "_hb_face_get_upem", \
	      "_hb_face_reference_table", \
	      "_hb_font_create", \
	      "_hb_font_get_face", \
	      "_hb_font_get_glyph_extents", \
	      "_hb_font_get_h_extents", \
	      "_hb_font_set_scale", \
	      "_hb_ot_color_glyph_get_layers", \
	      "_hb_ot_color_has_palettes", \
	      "_hb_ot_color_palette_get_colors", \
	      "_hb_ot_color_palette_get_count", \
	      "_hb_ot_glyph_path_create_from_font", \
	      "_hb_ot_glyph_path_destroy", \
	      "_hb_ot_glyph_path_get_commands", \
	      "_hb_ot_glyph_path_get_coords", \
	      "_hb_shape" ]' \
	  -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
	  -fno-exceptions -fno-rtti -fno-threadsafe-statics -fvisibility-inlines-hidden \
	  -Oz

all: hb.js

RanaKufi-VF.otf: $(FONTDIR)/RanaKufi-Regular.otf $(FONTDIR)/RanaKufi-Short.otf
	@echo " VF	$@"
	@make -C $(FONTDIR) $@
	@cp $(FONTDIR)/$@ $@

RanaKufi.c: RanaKufi-VF.otf
	@echo " GEN	$@"
	@xxd -i $< $@
	@sed -i -e "s/RanaKufi_VF_otf/RanaKufi/g" $@
	@sed -i -e "s/unsigned char/const char/g" $@

hb.js: harfbuzz.o font.o
	@echo " LINK	$@"
	@emcc $(EM_CFLAGS) -o $@ $^

font.o: font.c RanaKufi.c
	@echo " CC	$@"
	@emcc $(EM_CFLAGS) $(INCLUDES) -c $<

harfbuzz.o: $(HBDIR)/harfbuzz.cc
	@echo " C++	$@"
	@em++ $(EM_CFLAGS) $(INCLUDES) \
	  -std=c++11 \
	  -DHB_DISABLE_DEPRECATED \
	  -DHB_NDEBUG \
	  -DHB_MINI \
	  -DHB_NO_ATEXIT \
	  -DHB_NO_BITMAP \
	  -DHB_NO_BUFFER_MESSAGE \
	  -DHB_NO_BUFFER_SERIALIZE \
	  -DHB_NO_ERRNO \
	  -DHB_NO_FACE_COLLECT_UNICODES \
	  -DHB_NO_GETENV \
	  -DHB_NO_HINTING \
	  -DHB_NO_LANGUAGE_PRIVATE_SUBTAG \
	  -DHB_NO_LAYOUT_COLLECT_GLYPHS \
	  -DHB_NO_LAYOUT_FEATURE_PARAMS \
	  -DHB_NO_LAYOUT_UNUSED \
	  -DHB_NO_MATH \
	  -DHB_NO_META \
	  -DHB_NO_MMAP \
	  -DHB_NO_MT \
	  -DHB_NO_OPEN \
	  -DHB_NO_OT_FONT_GLYPH_NAMES \
	  -DHB_NO_OT_SHAPE_FRACTIONS \
	  -DHB_NO_SETLOCALE \
	  -DHB_NO_STAT \
	  -DHB_NO_SUBSET_LAYOUT \
	  -DHB_NO_UCD_UNASSIGNED \
	  -DHB_USE_INTERNAL_QSORT \
	  -DHB_OPTIMIZE_SIZE \
	  -c $<
