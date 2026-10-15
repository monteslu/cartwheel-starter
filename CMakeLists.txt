# Gem Dash, built against the prebuilt cartwheel engine SDK (./build.sh
# fetches it and configures this). Only the game compiles.
cmake_minimum_required(VERSION 3.20)
project(gemdash C CXX)
find_package(cartwheel REQUIRED CONFIG)

file(GLOB SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.c)
# the three.c programs the game draws with (./programs.sh regenerates them)
set(CW_PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/programs/gemdash.txt)
# the game
cw_add_app(gemdash SOURCES ${SRC} PACK ${CMAKE_CURRENT_SOURCE_DIR}/roots.txt)
# the same game playing itself (two bots, no menus): the tests and screenshots run it
cw_add_app(gemdash_auto SOURCES ${SRC} PACK ${CMAKE_CURRENT_SOURCE_DIR}/roots.txt)
target_compile_definitions(gemdash_auto PRIVATE GEMDASH_AUTOPILOT=1)
add_dependencies(gemdash_auto_pack gemdash_pack) # the packs share an import cache
