import alt from '../alt'

class HomeActions {
  constructor() {
    this.generateActions(
      'getTwoCharactersSuccess',
      'getTwoCharactersFail',
      'voteFail'
    )
  }

  getTwoCharacters() {
    $.ajax({ url: '/api/characters' })
      .done((data) => {
        this.getTwoCharactersSuccess(data)
      })
      .fail((jqXhr) => {
        this.getTwoCharactersFail(jqXhr.responseJSON.message)
      })
  }

  vote(winner, loser) {
    $.ajax({
      type: 'PUT',
      url: '/api/characters',
      data: { winner, loser }
    })
      .done(() => {
        this.actions.getTwoCharacters()
      })
      .fail(() => {
        this.actions.voteFail(jqXhr.responseJSON.message)
      })
  }
}

export default alt.createActions(HomeActions)
