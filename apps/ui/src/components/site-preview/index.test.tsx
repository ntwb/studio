import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	getBrowserShortcutCommand,
	getPathFromPreviewUrl,
	getSimulatedViewport,
	getToolbarPageTitle,
	SitePreview,
} from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: false, end: false } ),
} ) );

const useConnectorMock = vi.mocked( useConnector );

// Browser-style capabilities (no native dialogs, no preview annotation) — the
// component reads `connector.capabilities` to decide which toolbar controls show.
const CAPABILITIES = {
	nativeFolderPicker: false,
	nativeSaveDialog: false,
	openInOS: false,
	annotatePreview: false,
	readLocalMedia: false,
};

function renderPreview( children: ReactNode ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
	return render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>{ children }</Tooltip.Provider>
		</QueryClientProvider>
	);
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Example Site',
		path: '/Users/example/Studio/example-site',
		port: 8881,
		running: false,
		phpVersion: '8.3',
		...overrides,
	};
}

describe( 'SitePreview', () => {
	it( 'shows the current page title and exposes the URL in a tooltip', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const pageTitle = screen.getByText( 'Example Site' );
		expect( pageTitle ).toBeVisible();

		fireEvent.mouseEnter( pageTitle );
		fireEvent.mouseMove( pageTitle, { movementX: 1, movementY: 1 } );

		expect( screen.queryByText( 'http://localhost:8881/wp-admin/' ) ).not.toBeInTheDocument();
		// Tooltips use Base UI's default open delay, so wait long enough for the popup to appear.
		expect(
			await screen.findByText( 'http://localhost:8881/wp-admin/', {}, { timeout: 2000 } )
		).toBeVisible();
	} );

	it( 'shows adjacent toolbar tooltips immediately while the delay group is active', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const pageTitle = screen.getByText( 'Example Site' );
		fireEvent.mouseEnter( pageTitle );
		fireEvent.mouseMove( pageTitle, { movementX: 1, movementY: 1 } );

		await screen.findByText( 'http://localhost:8881/wp-admin/', {}, { timeout: 2000 } );

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( screen.queryByText( /^Refresh/ ) ).not.toBeInTheDocument();

		fireEvent.mouseLeave( pageTitle, { relatedTarget: refreshButton } );
		fireEvent.mouseEnter( refreshButton, { relatedTarget: pageTitle } );
		fireEvent.mouseMove( refreshButton, { movementX: 1, movementY: 1 } );

		const refreshTooltip = screen.getByText( /^Refresh/ );
		expect( refreshTooltip ).toBeInTheDocument();
		expect( refreshTooltip ).toHaveAttribute( 'data-instant', 'delay' );
	} );

	it( 'hides the browser controls when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/wp-admin/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'http://localhost:8881/wp-admin/' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start site' } ) ).toBeVisible();
	} );

	it( 'shows a refresh button that reloads the active preview surface', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );

		// jsdom reports a non-Apple platform: the navigation alias is Alt+arrow,
		// with the bracket chord kept as a secondary shortcut.
		expect( screen.getByRole( 'button', { name: 'Back' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			'Alt+ArrowLeft Control+['
		);
		expect( screen.getByRole( 'button', { name: 'Forward' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			'Alt+ArrowRight Control+]'
		);

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		fireEvent.click( refreshButton );

		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );
	} );

	it( 'reloads the preview on the primary-modifier+R shortcut', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		// jsdom reports a non-Apple platform, so the primary modifier is Ctrl.
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true } );
		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );

		// Extra modifiers must not trigger the shortcut.
		const reloadedIframe = container.querySelector( 'iframe' );
		fireEvent.keyDown( document.body, { key: 'r', ctrlKey: true, shiftKey: true } );
		expect( container.querySelector( 'iframe' ) ).toBe( reloadedIframe );
	} );

	it( 'hides the Annotate control when the host cannot annotate the preview', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		// The toolbar is present (Refresh shows) but Annotate is omitted entirely.
		expect( screen.getByRole( 'button', { name: 'Refresh' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the Annotate control when the host supports preview annotation', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: { ...CAPABILITIES, annotatePreview: true },
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeInTheDocument();
	} );

	it( 'offers responsive modes from the More options menu while running', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'More options' } ) );

		expect( await screen.findByText( 'Responsive mode' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Fit pane' } ) ).toBeChecked();
		// The orientation group only accompanies the phone frame.
		expect( screen.queryByText( 'Mobile orientation' ) ).not.toBeInTheDocument();

		// Radio items keep the menu open, so the orientation group appears in place.
		fireEvent.click( screen.getByRole( 'menuitemradio', { name: 'Mobile · 390×844' } ) );

		expect( await screen.findByText( 'Mobile orientation' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Portrait' } ) ).toBeChecked();

		// The menu is modal: its backdrop covers the webview, so clicks over
		// the preview dismiss the menu instead of vanishing into the guest.
		const backdrop = document.querySelector( '[role="presentation"][data-base-ui-inert]' );
		expect( backdrop ).toBeInTheDocument();
		fireEvent.pointerDown( backdrop as Element );
		await waitFor( () =>
			expect( screen.queryByText( 'Responsive mode' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'hides the More options menu when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
			capabilities: CAPABILITIES,
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'More options' } ) ).not.toBeInTheDocument();
	} );
} );

describe( 'getBrowserShortcutCommand', () => {
	// jsdom reports a non-Apple platform: primary modifier is Ctrl and the
	// navigation-arrow alias uses Alt.
	function makeEvent( overrides: Record< string, unknown > ) {
		return {
			defaultPrevented: false,
			repeat: false,
			key: '',
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			target: null,
			...overrides,
		} as unknown as KeyboardEvent;
	}

	it( 'maps the primary-modifier chords to commands', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'r', ctrlKey: true } ) ) ).toBe(
			'reload'
		);
		expect( getBrowserShortcutCommand( makeEvent( { key: '[', ctrlKey: true } ) ) ).toBe( 'back' );
		expect( getBrowserShortcutCommand( makeEvent( { key: ']', ctrlKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'maps the Alt+arrow aliases to back/forward', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true } ) ) ).toBe(
			'back'
		);
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowRight', altKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'ignores arrows with the wrong modifier, extra modifiers, or while editing text', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', ctrlKey: true } ) ) ).toBe(
			null
		);
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true, shiftKey: true } ) )
		).toBe( null );
		expect(
			getBrowserShortcutCommand(
				makeEvent( {
					key: 'ArrowLeft',
					altKey: true,
					target: document.createElement( 'textarea' ),
				} )
			)
		).toBe( null );
	} );
} );

describe( 'getToolbarPageTitle', () => {
	it( 'strips the WordPress admin suffix from document titles', () => {
		expect( getToolbarPageTitle( 'Dashboard ‹ Example Site — WordPress', 'Example Site' ) ).toBe(
			'Dashboard'
		);
		expect( getToolbarPageTitle( 'Posts ‹ My Blog — WordPress', 'My Blog' ) ).toBe( 'Posts' );
	} );

	it( 'returns front-end titles unchanged', () => {
		expect( getToolbarPageTitle( 'Example Site – Just another WordPress site', 'Example' ) ).toBe(
			'Example Site – Just another WordPress site'
		);
	} );

	it( 'falls back to the site name, then a generic label', () => {
		expect( getToolbarPageTitle( null, 'Example Site' ) ).toBe( 'Example Site' );
		expect( getToolbarPageTitle( '   ', 'Example Site' ) ).toBe( 'Example Site' );
		expect( getToolbarPageTitle( null, '' ) ).toBe( 'Site preview' );
	} );
} );

describe( 'getSimulatedViewport', () => {
	it( 'returns null without a preset or a measured pane', () => {
		expect( getSimulatedViewport( null, { width: 520, height: 700 } ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390, height: 844 }, null ) ).toBe( null );
		expect( getSimulatedViewport( { width: 390, height: 844 }, { width: 0, height: 700 } ) ).toBe(
			null
		);
	} );

	it( 'keeps presets at their exact dimensions, scaled down to fit both axes', () => {
		// The height binds: 700 / 844 is smaller than 520 / 390.
		expect(
			getSimulatedViewport( { width: 390, height: 844, mobile: true }, { width: 520, height: 700 } )
		).toEqual( {
			width: 390,
			height: 844,
			scale: 700 / 844,
			mobile: true,
		} );
		// The width binds for a desktop frame in a narrow pane.
		expect(
			getSimulatedViewport( { width: 1440, height: 900 }, { width: 720, height: 800 } )
		).toEqual( {
			width: 1440,
			height: 900,
			scale: 0.5,
			mobile: false,
		} );
	} );

	it( 'never scales up in a larger pane', () => {
		expect(
			getSimulatedViewport( { width: 390, height: 844 }, { width: 600, height: 1000 } )
		).toEqual( {
			width: 390,
			height: 844,
			scale: 1,
			mobile: false,
		} );
	} );
} );

describe( 'getPathFromPreviewUrl', () => {
	it( 'extracts the path, search, and hash for same-origin urls', () => {
		expect(
			getPathFromPreviewUrl( 'http://localhost:8881/wp-admin/?page=1#top', 'http://localhost:8881' )
		).toBe( '/wp-admin/?page=1#top' );
	} );

	it( 'returns null for cross-origin or invalid urls', () => {
		expect( getPathFromPreviewUrl( 'https://example.com/about', 'http://localhost:8881' ) ).toBe(
			null
		);
		expect( getPathFromPreviewUrl( 'not-a-url', 'http://localhost:8881' ) ).toBe( null );
	} );
} );
