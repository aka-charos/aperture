import { createContext } from 'react'

export interface OpenHelpOptions {
  /** A heading on the first page to scroll to, as its ENGLISH heading id (mapped onto a translation). */
  anchor?: string
  /**
   * Offer the tour of the screen underneath ("Show me around"). Only for help
   * opened ABOUT that screen (the app bar's ?, a screen's tip): an inline ?
   * can sit inside a title page opened in a dialog over another screen, whose
   * tour would point at things the dialog covers.
   */
  offerScreenTour?: boolean
}

export interface UserHelpContextValue {
  /**
   * Open the user guide beside the screen at the given pages. With no pages it
   * opens the pages for the screen on show, or the guide's contents where none
   * describes it — what the app bar's ? button does.
   */
  openHelp: (docs?: readonly string[], options?: OpenHelpOptions) => void
  /** The drawer is showing (a tour steps aside while it is). */
  isOpen: boolean
}

/**
 * Who may open the user guide drawer: the app bar's ? button, a first-visit
 * hint, an inline ? icon on a dense widget, a tour step's "Read more". Provided
 * by Layout, so there is one drawer however many things open it.
 */
export const UserHelpContext = createContext<UserHelpContextValue | null>(null)
