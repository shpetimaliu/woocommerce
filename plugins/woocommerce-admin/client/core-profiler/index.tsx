/**
 * External dependencies
 */
import { createMachine, assign, DoneInvokeEvent, actions } from 'xstate';
import { useMachine } from '@xstate/react';
import { useEffect, useMemo } from '@wordpress/element';
import { resolveSelect, dispatch } from '@wordpress/data';
import {
	ExtensionList,
	OPTIONS_STORE_NAME,
	COUNTRIES_STORE_NAME,
} from '@woocommerce/data';
import { recordEvent } from '@woocommerce/tracks';
import { getSetting } from '@woocommerce/settings';
import { initializeExPlat } from '@woocommerce/explat';
import { getNewPath } from '@woocommerce/navigation';

/**
 * Internal dependencies
 */
import { IntroOptIn } from './pages/IntroOptIn';
import { UserProfile } from './pages/UserProfile';
import { BusinessInfo } from './pages/BusinessInfo';
import { BusinessLocation } from './pages/BusinessLocation';
import { getCountryStateOptions, Country } from './services/country';
import { Loader } from './pages/Loader';

import './style.scss';

/** Uncomment below to display xstate inspector during development */
// import { inspect } from '@xstate/inspect';
// inspect( {
// 	// url: 'https://stately.ai/viz?inspect', // (default)
// 	iframe: false, // open in new window
// } );

// TODO: Typescript support can be improved, but for now lets write the types ourselves
// https://stately.ai/blog/introducing-typescript-typegen-for-xstate

export type InitializationCompleteEvent = {
	type: 'INITIALIZATION_COMPLETE';
	payload: { optInDataSharing: boolean };
};

export type IntroOptInEvent =
	| { type: 'INTRO_COMPLETED'; payload: { optInDataSharing: boolean } } // can be true or false depending on whether the user opted in or not
	| { type: 'INTRO_SKIPPED'; payload: { optInDataSharing: false } }; // always false for now

export type UserProfileEvent =
	| {
			type: 'USER_PROFILE_COMPLETED';
			payload: {
				userProfile: CoreProfilerStateMachineContext[ 'userProfile' ];
			}; // TODO: fill in the types for this when developing this page
	  }
	| {
			type: 'USER_PROFILE_SKIPPED';
			payload: { userProfile: { skipped: true } };
	  };

export type BusinessInfoEvent = {
	type: 'BUSINESS_INFO_COMPLETED';
	payload: {
		businessInfo: CoreProfilerStateMachineContext[ 'businessInfo' ];
	};
};

export type BusinessLocationEvent = {
	type: 'BUSINESS_LOCATION_COMPLETED';
	payload: {
		businessInfo: CoreProfilerStateMachineContext[ 'businessInfo' ];
	};
};

export type ExtensionsEvent = {
	type: 'EXTENSIONS_COMPLETED';
	payload: {
		extensionsSelected: CoreProfilerStateMachineContext[ 'extensionsSelected' ];
	};
};

export type CoreProfilerStateMachineContext = {
	optInDataSharing: boolean;
	userProfile: { foo: { bar: 'qux' }; skipped: false } | { skipped: true };
	geolocatedLocation: {
		location: string;
	};
	extensionsAvailable: ExtensionList[ 'plugins' ] | [  ];
	extensionsSelected: string[]; // extension slugs
	businessInfo: { foo?: { bar: 'qux' }; location: string };
	countries: { [ key: string ]: string };
	loader: {
		className?: string;
		useStages?: string;
		stageIndex?: number;
	};
};

const Extensions = ( {
	context,
	sendEvent,
}: {
	context: CoreProfilerStateMachineContext;
	sendEvent: ( payload: ExtensionsEvent ) => void;
} ) => {
	return (
		// TOOD: we need to fetch the extensions list from the API as part of initializing the profiler
		<>
			<div>Extensions</div>
			<div>{ context.extensionsAvailable }</div>
			<button
				onClick={ () =>
					sendEvent( {
						type: 'EXTENSIONS_COMPLETED',
						payload: {
							extensionsSelected: [ 'woocommerce-payments' ],
						},
					} )
				}
			>
				Next
			</button>
		</>
	);
};

const getAllowTrackingOption = async () =>
	resolveSelect( OPTIONS_STORE_NAME ).getOption(
		'woocommerce_allow_tracking'
	);

const handleTrackingOption = assign( {
	optInDataSharing: (
		_context,
		event: DoneInvokeEvent< 'no' | 'yes' | undefined >
	) => event.data !== 'no',
} );

const getCountries = async () =>
	resolveSelect( COUNTRIES_STORE_NAME ).getCountries();

const handleCountries = assign( {
	countries: ( _context, event: DoneInvokeEvent< Country[] > ) => {
		return getCountryStateOptions( event.data );
	},
} );

const redirectToWooHome = () => {
	const homescreenUrl = new URL(
		getNewPath( {}, '/', {} ),
		window.location.href
	).href;
	window.location.href = homescreenUrl;
};

const recordTracksIntroCompleted = () => {
	recordEvent( 'storeprofiler_step_complete', {
		step: 'store_details',
		wc_version: getSetting( 'wcVersion' ),
	} );
};

const recordTracksIntroSkipped = () => {
	recordEvent( 'storeprofiler_store_details_skip' );
};

const recordTracksIntroViewed = () => {
	recordEvent( 'storeprofiler_step_view', {
		step: 'store_details',
		wc_version: getSetting( 'wcVersion' ),
	} );
};

const recordTracksSkipBusinessLocationViewed = () => {
	recordEvent( 'storeprofiler_step_view', {
		step: 'skip_business_location',
		wc_version: getSetting( 'wcVersion' ),
	} );
};

const recordTracksSkipBusinessLocationCompleted = () => {
	recordEvent( 'storeprofiler_step_complete', {
		step: 'skp_business_location',
		wc_version: getSetting( 'wcVersion' ),
	} );
};

const updateTrackingOption = (
	_context: CoreProfilerStateMachineContext,
	event: IntroOptInEvent
) => {
	if (
		event.payload.optInDataSharing &&
		typeof window.wcTracks.enable === 'function'
	) {
		window.wcTracks.enable( () => {
			initializeExPlat();
		} );
	} else if ( ! event.payload.optInDataSharing ) {
		window.wcTracks.isEnabled = false;
	}

	const trackingValue = event.payload.optInDataSharing ? 'yes' : 'no';
	dispatch( OPTIONS_STORE_NAME ).updateOptions( {
		woocommerce_allow_tracking: trackingValue,
	} );
};

/**
 * Assigns the optInDataSharing value from the event payload to the context
 */
const assignOptInDataSharing = assign( {
	optInDataSharing: ( _context, event: IntroOptInEvent ) =>
		event.payload.optInDataSharing,
} );

const coreProfilerStateMachineDefinition = createMachine( {
	id: 'coreProfiler',
	initial: 'initializing',
	predictableActionArguments: true, // recommended setting: https://xstate.js.org/docs/guides/actions.html
	context: {
		// these are safe default values if for some reason the steps fail to complete correctly
		// actual defaults displayed to the user should be handled in the steps themselves
		optInDataSharing: false,
		userProfile: { skipped: true },
		geolocatedLocation: { location: 'US:CA' },
		businessInfo: { location: 'US:CA' },
		extensionsAvailable: [],
		extensionsSelected: [],
		countries: {},
		loader: {},
	} as CoreProfilerStateMachineContext,
	states: {
		initializing: {
			on: {
				INITIALIZATION_COMPLETE: {
					target: 'introOptIn',
				},
			},
			invoke: [
				{
					src: 'getAllowTrackingOption',
					onDone: [
						{
							actions: [ 'handleTrackingOption' ],
							target: 'introOptIn',
						},
					],
					onError: {
						target: 'introOptIn', // leave it as initialised default on error
					},
				},
			],
			meta: {
				progress: 0,
			},
		},
		introOptIn: {
			on: {
				INTRO_COMPLETED: {
					target: 'userProfile',
					actions: [
						'assignOptInDataSharing',
						'updateTrackingOption',
					],
				},
				INTRO_SKIPPED: {
					// if the user skips the intro, we set the optInDataSharing to false and go to the Business Location page
					target: 'preSkipFlowBusinessLocation',
					actions: [
						'assignOptInDataSharing',
						'updateTrackingOption',
					],
				},
			},
			entry: [ 'recordTracksIntroViewed' ],
			exit: actions.choose( [
				{
					cond: ( _context, event ) =>
						event.type === 'INTRO_COMPLETED',
					actions: 'recordTracksIntroCompleted',
				},
				{
					cond: ( _context, event ) => event.type === 'INTRO_SKIPPED',
					actions: 'recordTracksIntroSkipped',
				},
			] ),
			meta: {
				progress: 20,
				component: IntroOptIn,
			},
		},
		userProfile: {
			on: {
				USER_PROFILE_COMPLETED: {
					target: 'preBusinessInfo',
					actions: [
						assign( {
							userProfile: ( context, event: UserProfileEvent ) =>
								event.payload.userProfile, // sets context.userProfile to the payload of the event
						} ),
					],
				},
				USER_PROFILE_SKIPPED: {
					target: 'preBusinessInfo',
					actions: [
						assign( {
							userProfile: ( context, event: UserProfileEvent ) =>
								event.payload.userProfile, // assign context.userProfile to the payload of the event
						} ),
					],
				},
			},
			meta: {
				progress: 40,
				component: UserProfile,
			},
		},
		preBusinessInfo: {
			always: [
				// immediately transition to businessInfo without any events as long as geolocation parallel has completed
				{
					target: 'businessInfo',
					cond: () => true, // TODO: use a custom function to check on the parallel state using meta when we implement that. https://xstate.js.org/docs/guides/guards.html#guards-condition-functions
				},
			],
			meta: {
				progress: 50,
			},
		},
		businessInfo: {
			on: {
				BUSINESS_INFO_COMPLETED: {
					target: 'preExtensions',
					actions: [
						assign( {
							businessInfo: (
								_context,
								event: BusinessInfoEvent
							) => event.payload.businessInfo, // assign context.businessInfo to the payload of the event
						} ),
					],
				},
			},
			meta: {
				progress: 60,
				component: BusinessInfo,
			},
		},
		preSkipFlowBusinessLocation: {
			invoke: [
				{
					src: 'getCountries',
					onDone: [
						{
							actions: [ 'handleCountries' ],
							target: 'skipFlowBusinessLocation',
						},
					],
					onError: {
						target: 'skipFlowBusinessLocation',
					},
				},
			],
		},
		skipFlowBusinessLocation: {
			on: {
				BUSINESS_LOCATION_COMPLETED: {
					target: 'postSkipFlowBusinessLocation',
					actions: [
						assign( {
							businessInfo: (
								_context,
								event: BusinessLocationEvent
							) => event.payload.businessInfo, // assign context.businessInfo to the payload of the event
						} ),
						'recordTracksSkipBusinessLocationCompleted',
					],
				},
			},
			entry: [ 'recordTracksSkipBusinessLocationViewed' ],
			meta: {
				progress: 80,
				component: BusinessLocation,
			},
		},
		postSkipFlowBusinessLocation: {
			invoke: {
				src: () => {
					// show the loader for 3 seconds
					return new Promise( ( resolve ) => {
						setTimeout( resolve, 3000 );
					} );
				},
				onDone: {
					actions: [ 'redirectToWooHome' ],
				},
			},
			meta: {
				component: Loader,
			},
		},
		preExtensions: {
			always: [
				// immediately transition to extensions without any events as long as extensions fetching parallel has completed
				{
					target: 'extensions',
					cond: () => true, // TODO: use a custom function to check on the parallel state using meta when we implement that. https://xstate.js.org/docs/guides/guards.html#guards-condition-functions
				},
			],
			// add exit action to filter the extensions using a custom function here and assign it to context.extensionsAvailable
			exit: assign( {
				extensionsAvailable: ( context ) => {
					return context.extensionsAvailable.filter( () => true );
				}, // TODO : define an extensible filter function here
			} ),
			meta: {
				progress: 70,
			},
		},
		extensions: {
			on: {
				EXTENSIONS_COMPLETED: {
					target: 'settingUpStore',
				},
			},
			meta: {
				progress: 80,
				component: Extensions,
			},
		},
		settingUpStore: {},
	},
} );

const CoreProfilerController = ( {} ) => {
	const augmentedStateMachine = useMemo( () => {
		// When adding extensibility, this is the place to manipulate the state machine definition.
		return coreProfilerStateMachineDefinition.withConfig( {
			actions: {
				updateTrackingOption,
				handleTrackingOption,
				recordTracksIntroCompleted,
				recordTracksIntroSkipped,
				recordTracksIntroViewed,
				recordTracksSkipBusinessLocationViewed,
				recordTracksSkipBusinessLocationCompleted,
				assignOptInDataSharing,
				handleCountries,
				redirectToWooHome,
			},
			services: {
				getAllowTrackingOption,
				getCountries,
			},
		} );
	}, [] );

	const [ state, send ] = useMachine( augmentedStateMachine );
	const stateValue =
		typeof state.value === 'object'
			? Object.keys( state.value )[ 0 ]
			: state.value;
	const currentNodeMeta = state.meta[ `coreProfiler.${ stateValue }` ]
		? state.meta[ `coreProfiler.${ stateValue }` ]
		: undefined;
	const navigationProgress = currentNodeMeta?.progress; // This value is defined in each state node's meta tag, we can assume it is 0-100
	const CurrentComponent =
		currentNodeMeta?.component ?? ( () => <div>Insert Spinner</div> ); // If no component is defined for the state then its a loading state

	useEffect( () => {
		document.body.classList.remove( 'woocommerce-admin-is-loading' );
		document.body.classList.add( 'woocommerce-profile-wizard__body' );
		document.body.classList.add( 'woocommerce-admin-full-screen' );
		document.body.classList.add( 'is-wp-toolbar-disabled' );
		return () => {
			document.body.classList.remove(
				'woocommerce-profile-wizard__body'
			);
			document.body.classList.remove( 'woocommerce-admin-full-screen' );
			document.body.classList.remove( 'is-wp-toolbar-disabled' );
		};
	} );

	return (
		<>
			<div
				className={ `woocommerce-profile-wizard__container woocommerce-profile-wizard__step-${ state.value }` }
			>
				{
					<CurrentComponent
						navigationProgress={ navigationProgress }
						sendEvent={ send }
						context={ state.context }
					/>
				}
			</div>
		</>
	);
};
export default CoreProfilerController;
