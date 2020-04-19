# Copyright (c) 2020 Khaled Hosny
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

HBDIR = harfbuzz/src

EM_CFLAGS = \
	  --llvm-lto 1 \
	  -s ENVIRONMENT=web \
	  -s FILESYSTEM=0 \
	  -s RESERVED_FUNCTION_POINTERS=5 \
	  -s 'EXTRA_EXPORTED_RUNTIME_METHODS=["stackAlloc", "addFunction"]' \
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
	      "_hb_font_draw_glyph", \
	      "_hb_draw_funcs_create", \
	      "_hb_draw_funcs_set_close_path_func", \
	      "_hb_draw_funcs_set_quadratic_to_func", \
	      "_hb_draw_funcs_set_cubic_to_func", \
	      "_hb_draw_funcs_set_line_to_func", \
	      "_hb_draw_funcs_set_move_to_func", \
	      "_hb_shape" ]' \
	  -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 \
	  -fno-exceptions -fno-rtti -fno-threadsafe-statics -fvisibility-inlines-hidden \
	  -Oz

.PHONY: all

all: hb.js

hb.js: harfbuzz.o
	@echo " LINK	$@"
	@emcc $(EM_CFLAGS) -o $@ $^

harfbuzz.o: $(HBDIR)/harfbuzz.cc
	@echo " C++	$@"
	@em++ $(EM_CFLAGS) \
	  -std=c++11 \
	  -DHB_EXPERIMENTAL_API \
	  -DHB_DISABLE_DEPRECATED \
	  -DHB_NDEBUG \
	  -DHB_MINI \
	  -DHB_NO_ATEXIT \
	  -DHB_NO_BITMAP \
	  -DHB_NO_BUFFER_MESSAGE \
	  -DHB_NO_BUFFER_SERIALIZE \
	  -DHB_NO_COLOR \
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
	  -DHB_NO_NAME \
	  -DHB_NO_OPEN \
	  -DHB_NO_OT_FONT_GLYPH_NAMES \
	  -DHB_NO_OT_SHAPE_FRACTIONS \
	  -DHB_NO_SETLOCALE \
	  -DHB_NO_STAT \
	  -DHB_NO_SUBSET_LAYOUT \
	  -DHB_NO_UCD \
	  -DHB_NO_UCD_UNASSIGNED \
	  -DHB_NO_UNICODE_FUNCS \
	  -DHB_NO_VAR \
	  -DHB_USE_INTERNAL_QSORT \
	  -DHB_OPTIMIZE_SIZE \
	  -c $<
