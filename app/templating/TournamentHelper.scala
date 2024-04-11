package lila.app
package templating

import controllers.routes
import play.api.i18n.Lang
import play.api.libs.json.Json

import lila.app.ui.ScalatagsTemplate.*
import lila.common.Json.given
import lila.rating.PerfType
import lila.tournament.{ Schedule, Tournament }
import lila.user.User
import lila.core.i18n.Translate
import lila.common.Icon

trait TournamentHelper extends HasEnv:
  self: I18nHelper & DateHelper & UserHelper & StringHelper & NumberHelper =>

  def netBaseUrl: String

  def tournamentJsData(tour: Tournament, version: Int, user: Option[User]) =

    val data = Json.obj(
      "tournament" -> Json.obj("id" -> tour.id),
      "version"    -> version
    )
    Json.stringify {
      user.fold(data) { u =>
        data ++ Json.obj("username" -> u.username)
      }
    }

  def tournamentLink(tour: Tournament)(using Translate): Frag =
    a(
      dataIcon := Icon.Trophy.value,
      cls      := (if tour.isScheduled then "text is-gold" else "text"),
      href     := routes.Tournament.show(tour.id.value).url
    )(tour.name())

  def tournamentLink(tourId: TourId)(using Translate): Frag =
    a(
      dataIcon := Icon.Trophy.value,
      cls      := "text",
      href     := routes.Tournament.show(tourId.value).url
    )(tournamentIdToName(tourId))

  def tournamentIdToName(id: TourId)(using Translate): String =
    env.tournament.getTourName.sync(id).getOrElse("Tournament")

  object scheduledTournamentNameShortHtml:
    private def icon(c: Icon) = s"""<span data-icon="$c"></span>"""
    private val replacements =
      given lila.core.i18n.Translate = lila.i18n.Translator.toDefault
      List(
        "Lichess "    -> "",
        "Marathon"    -> icon(Icon.Globe),
        "HyperBullet" -> s"H${icon(PerfType.Bullet.icon)}",
        "SuperBlitz"  -> s"S${icon(PerfType.Blitz.icon)}"
      ) ::: lila.rating.PerfType.leaderboardable.filterNot(lila.rating.PerfType.translated.contains).map {
        pt =>
          pt.trans -> icon(pt.icon)
      }
    def apply(name: String): Frag = raw:
      replacements.foldLeft(name):
        case (n, (from, to)) => n.replace(from, to)

  def tournamentIcon(tour: Tournament): Icon =
    tour.schedule.map(_.freq) match
      case Some(Schedule.Freq.Marathon | Schedule.Freq.ExperimentalMarathon) => Icon.Globe
      case _ => tour.spotlight.flatMap(_.iconFont) | tour.perfType.icon
