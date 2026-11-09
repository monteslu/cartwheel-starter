# The game, built against the prebuilt cartwheel engine SDK (./build.sh fetches
# it and configures this). Only the game compiles. Its name is `app` in
# project.cwproj: rename the game there and nowhere else.
cmake_minimum_required(VERSION 3.20)
file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/project.cwproj _app REGEX "^app *=")
string(REGEX REPLACE "^app *= *\"?([A-Za-z_][A-Za-z0-9_]*)\"?.*$" "\\1" APP "${_app}")
if(NOT APP MATCHES "^[A-Za-z_][A-Za-z0-9_]*$")
  message(FATAL_ERROR "project.cwproj: set `app = <name>` (a C identifier: the executable and cart name)")
endif()
project(${APP} C CXX)
find_package(cartwheel REQUIRED CONFIG)

file(GLOB SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.c)
# the three.c programs the game draws with (./programs.sh regenerates them)
set(CW_PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/programs/game.txt)
# the game
cw_add_app(${APP} SOURCES ${SRC} PACK ${CMAKE_CURRENT_SOURCE_DIR}/roots.txt)
# the same game playing itself (GAME_AUTOPILOT: straight into play, the player
# driven by the game's own on-screen cues): screenshots and the checks that
# need play without menus run it
cw_add_app(${APP}_auto SOURCES ${SRC} PACK ${CMAKE_CURRENT_SOURCE_DIR}/roots.txt)
target_compile_definitions(${APP}_auto PRIVATE GAME_AUTOPILOT=1)
add_dependencies(${APP}_auto_pack ${APP}_pack) # the packs share an import cache
